# BlazerJob – Task Scheduler Library

**BlazerJob** is a SQLite-backed (optional) task scheduler for Node.js and TypeScript.
It orchestrates custom functions and native HTTP calls, returns typed results, and can persist work across restarts.

Delivery is **at least once**. Handlers must be idempotent. BlazerJob does not promise exactly-once execution.

## Quick start

```typescript
import { BlazeJob } from "blazerjob";

const jobs = new BlazeJob({
  storage: "sqlite",
  dbPath: "./blazerjob.db",
  concurrency: 4
});

jobs.registerHandler("hello", async () => {
  return { ok: true };
});

const id = jobs.schedule(undefined, {
  runAt: new Date(),
  handler: "hello",
  payload: { source: "app" }
});

await jobs.start();
const snapshot = await jobs.waitFor(id);
console.log(snapshot.status, snapshot.result);
await jobs.shutdown();
```

In-memory anonymous functions still work, but **they cannot be resumed after a restart**.

```typescript
const jobs = new BlazeJob({ concurrency: 16 });
jobs.schedule(async () => {
  console.log("Job executed");
}, { runAt: new Date() });
await jobs.start();
```

# Task types

| Task type | How to schedule | Resume after restart |
|-----------|-----------------|----------------------|
| `custom` with `handler` + JSON `payload` | `schedule(undefined, { handler, payload })` | Yes, after `registerHandler` |
| `custom` with an in-memory function | `schedule(fn, { type: 'custom' })` | No |
| `http` | `schedule(undefined, { type: 'http', config })` or `scheduleHttp(config)` | Yes |

A native HTTP task **must not** include a custom function. Passing both throws a `CONFLICTING_HANDLER` error.

## Named handlers (required for persistent custom work)

```typescript
const jobs = new BlazeJob({ storage: "sqlite", dbPath: "./tasks.db" });

jobs.registerHandler("charge", async (payload, ctx) => {
  // Use ctx.signal to abort cooperatively.
  return { charged: payload.amount };
});

jobs.schedule(undefined, {
  handler: "charge",
  payload: { amount: 10 },
  runAt: new Date(),
  timeoutMs: 5_000,
  retry: { maxAttempts: 5, backoffMs: 200, policy: "transient" }
});
```

If a persisted task names a handler that is not registered, the task becomes `blocked` with a structured error. It is **never** marked `success`. Registering the handler moves it back to `pending`.

Anonymous functions are kept in a process-local map. BlazerJob never serializes JavaScript functions and never uses `eval`.

## HTTP tasks

```typescript
jobs.schedule(undefined, {
  runAt: new Date(),
  type: "http",
  config: {
    url: "https://httpbin.org/post",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { hello: "world" }
  }
});

// or
jobs.scheduleHttp(
  { url: "https://api.example.com/v1/price", method: "GET" },
  { runAt: new Date(), timeoutMs: 3_000 }
);

const snapshot = await jobs.waitFor(taskId);
// snapshot.result = { status, ok, headers, body, bodyType: 'json' | 'text' | 'empty' }
```

Empty bodies and invalid JSON are returned as `bodyType: 'empty'` or `'text'`. Useful response headers are stored; `Authorization` is never persisted in results.

## Results

`schedule()` still returns a numeric id.

```typescript
const snapshot = await jobs.waitFor(id);
jobs.getTask(id);
jobs.getTaskResult(id);
jobs.on("task", (snapshot) => {
  // Exceptions here are swallowed and never fail or retry the task.
});
```

Snapshot fields: `id`, `status`, `result`, `error`, `executedAt`, `startedAt`, `attempts`, `runCount`.

In SQLite mode, results are stored with a configurable size cap (`resultRetention.maxBytes`, default 64 KiB) and optional TTL (`resultRetention.ttlMs`). Do not put secrets in payloads you persist.

## Retries, timeouts, cancellation

- `retriesLeft` from v2.0.8 is still honored: `retriesLeft: 2` means 3 attempts.
- `retry.maxAttempts`, `backoffMs`, `backoffMultiplier`, `jitter`, `policy: 'transient' | 'all' | 'none'`.
- Transient HTTP retries: 408, 425, 429, 5xx, network errors. Other 4xx are permanent unless `policy: 'all'`.
- HTTP `Retry-After` overrides backoff for that attempt.
- `timeoutMs` bounds **one execution** and is passed to `fetch` / handlers as `AbortSignal`.
- `maxDurationMs` bounds the **lifetime** of the task (including repeats).
- A request is aborted before a retry of the same work starts. If a handler ignores `signal`, it still occupies a worker slot until it returns; then the result is discarded if the task was cancelled or timed out.

```typescript
jobs.cancel(id); // pending: never starts; running: abort, no further retries, status cancelled
jobs.deleteTask(id); // removes the row; this is not cancellation of an in-flight HTTP request
```

## Shutdown (NestJS)

The library **does not** register `SIGINT`/`SIGTERM` and **does not** call `process.exit()` on import. `autoExit` only stops the timer and closes SQLite.

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { BlazeJob } from "blazerjob";

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private jobs = new BlazeJob({ storage: "sqlite", dbPath: "./blazerjob.db", concurrency: 4 });

  async onModuleInit() {
    this.jobs.registerHandler("sync", async (payload, ctx) => {
      return { synced: true, payload };
    });
    await this.jobs.start();
  }

  async onModuleDestroy() {
    await this.jobs.shutdown({ timeoutMs: 10_000 });
  }
}
```

`shutdown` stops claiming new work, waits up to `timeoutMs` for active tasks, aborts stragglers, then closes SQLite.

## Concurrency and rate limits

Both are **local to the process**. There is no cluster-wide quota and no call to any external API product.

- `concurrency`: max tasks executing at once (integer >= 1, default 1).
- `rate: { maxStarts, intervalMs }`: max **starts** in a sliding window.

## Storage

Memory (default): SQLite `:memory:`. SQLite file: `storage: 'sqlite', dbPath: './tasks.db'` with WAL.

Running tasks use a persisted **lease** (`leaseMs`, default 30s). After a crash, another worker may claim a task only when `lease_until` is expired. BlazerJob does not blindly reset every `running` row to `pending` (another worker may still be executing it).

## Encryption

Configs are stored as plaintext JSON unless you set `encryptConfigs: true` **and** pass `encryptionKey` (or `BLAZERJOB_ENCRYPTION_KEY`). There is no implicit default key.

If existing rows are `enc:v1:` and no key is provided, BlazerJob throws. Data written with <=2.0.8's former default key can be read by passing
`encryptionKey: "default_blazerjob_secret_do_not_use_in_prod"`.

Bodies, `Authorization` headers, and decrypted configs are not written to scheduler logs.

## HTTP management server

```typescript
import { startServer, stopServer } from "blazerjob";

await startServer(9000, { storage: "sqlite", dbPath: "./blazerjob.db" });
```

- `GET /tasks` — list tasks with secrets redacted
- `POST /task` — HTTP config or named handler only (no anonymous functions)
- `POST /task/:id/cancel` — cooperative cancel
- `DELETE /task/:id` — delete metadata; not an abort of the live HTTP socket

Signal handlers that call `process.exit` belong on the CLI (`blazerjob`), not in `require('blazerjob')`.

## Webhooks

If `webhookUrl` is set, BlazerJob POSTs `{ taskId, status, executedAt, result, output, error }` on success, failure, or retry. Webhook failures do not change the task status.

## Installation

```bash
npm install blazerjob
```

Requires Node.js 22+. Native `better-sqlite3` bindings need a C/C++ toolchain.

### Migrating from 2.0.8

- Re-register named handlers at process start; anonymous persisted jobs fail with `NON_RESUMABLE` instead of a fake success.
- Remove empty `async () => {}` from HTTP `schedule()` calls.
- Provide an encryption key only if you encrypt, or if you must read old `enc:v1` rows.
- Replace `autoExit` process-exit assumptions with `shutdown()`.
- Default HTTP method is `GET` when omitted (pass `method: 'POST'` explicitly).

## API

### `new BlazeJob(options)`

`storage`, `dbPath`, `concurrency`, `rate`, `autoExit`, `encryptionKey`, `encryptConfigs`, `debug`, `persistResults`, `resultRetention`, `leaseMs`, `workerId`.

### `schedule(taskFn, opts): number`

`runAt`, `interval`, `priority`, `retriesLeft`, `type`, `config`, `webhookUrl`, `maxRuns`, `maxDurationMs`, `timeoutMs`, `handler`, `payload`, `retry`, `onEnd`.

### Other methods

`registerHandler`, `scheduleHttp`, `start`, `stop`, `shutdown`, `close`, `waitFor`, `getTask`, `getTaskResult`, `getTasks`, `cancel`, `deleteTask`, `on('task')`, `onAllTasksEnded`.

## License

ISC
