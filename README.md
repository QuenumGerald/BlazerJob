# BlazerJob – Task Scheduler Library

**BlazerJob** is a lightweight, SQLite-backed task scheduler for Node.js and TypeScript applications.
Use it as a library in your code to schedule, execute, and manage asynchronous tasks.

# Task Types

BlazerJob supports two types of tasks:

| Task Type | Description                                    |
|-----------|------------------------------------------------|
| `custom`  | Arbitrary JavaScript/TypeScript functions (most flexible) |
| `http`    | Generic HTTP requests (GET, POST, etc.)        |

## 1. Custom Tasks (Arbitrary JavaScript/TypeScript)

BlazerJob can schedule and execute any custom asynchronous JavaScript/TypeScript function. This is the most flexible way to use the scheduler, and is ideal for business logic, scripts, or workflows that don't fit a predefined connector.

### Example: Custom Task
```typescript
const jobs = new BlazeJob({ dbPath: './tasks.db', concurrency: 16 });

jobs.schedule(async () => {
  // Your custom logic here
  console.log('Hello from a custom task!');
  // You can use any Node.js/TypeScript code
}, {
  runAt: new Date(),
  interval: 5000, // optional: repeat every 5 seconds
  maxRuns: 3,     // optional: stop after 3 executions
  onEnd: (stats) => {
    console.log('Task finished. Stats:', stats);
  }
});

jobs.start();
```

### Storage Options

BlazerJob supports two storage modes:

#### Memory Storage (Default)
BlazerJob uses **in-memory storage** by default for maximum performance. Tasks are stored in RAM using SQLite's `:memory:` mode and are lost when the process restarts.

```typescript
const jobs = new BlazeJob({
  concurrency: 16
});
```

**Use case**: Ideal for testing, temporary tasks, or when persistence is not required.

#### SQLite File Storage (Persistent)
For persistent task storage across process restarts, use SQLite file storage:

```typescript
const jobs = new BlazeJob({
  storage: 'sqlite',
  dbPath: './tasks.db',
  concurrency: 16
});
```

**Use case**: Production environments where task persistence is required.

> **Note**: Custom JavaScript/TypeScript task functions are always stored in memory (via `Map`), regardless of storage mode. Only task metadata and configurations are persisted to SQLite.

---

## 2. HTTP Tasks (API Calls)

BlazerJob natively supports HTTP tasks for scheduling API calls (GET, POST, etc.).

### Example: HTTP POST Request
```typescript
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'http',
  config: JSON.stringify({
    url: 'https://httpbin.org/post',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { hello: 'world' }
  })
});
```

### Example: HTTP GET Request
```typescript
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'http',
  config: JSON.stringify({
    url: 'https://api.coindesk.com/v1/bpi/currentprice.json',
    method: 'GET'
  })
});
```

---

## CLI

BlazerJob provides a CLI to easily manage your scheduled tasks:

```bash
# Show help
npx ts-node src/bin/cli.ts help

# Schedule a task (e.g., http)
npx ts-node src/bin/cli.ts schedule --type http --runAt "2025-01-01T00:00:00Z"

# List tasks (default blazerjob.db)
npx ts-node src/bin/cli.ts list

# List tasks from ALL .db files in the current directory
ts-node src/bin/cli.ts list-all

# Delete a task
npx ts-node src/bin/cli.ts delete 123
```

### Available Commands

#### `list-all`
Displays tasks from all `.db` files in the current directory, with separate sections for each database.

**Example Output:**
```
=== Database: blazerjob.db ===
┌─────────┬────┬─────────┬────────────────────────────┬──────────┬─────────────────────────────┐
│ (index) │ id │  type   │           runAt            │  status  │          config             │
├─────────┼────┼─────────┼────────────────────────────┼──────────┼─────────────────────────────┤
│    0    │ 1  │ 'cosmos' │ '2025-05-05T21:24:13.727Z' │ 'failed' │ '{"cmd":"echo test"}'       │
└─────────┴────┴─────────┴────────────────────────────┴──────────┴─────────────────────────────┘

=== Database: tasks_cosmos_query.db ===
┌─────────┬────┬──────────┬────────────────────────────┬──────────┬─────────────────────────────────────┐
│ (index) │ id │   type   │           runAt            │  status  │              config                 │
├─────────┼────┼──────────┼────────────────────────────┼──────────┼─────────────────────────────────────┤
│    0    │ 42 │ 'cosmos' │ '2025-05-06T02:21:28.275Z' │ 'failed' │ '{"queryType":"balance",...}'     │
└─────────┴────┴──────────┴────────────────────────────┴──────────┴─────────────────────────────────────┘
```

#### `list`
Shows tasks only from the default database (`blazerjob.db`).

#### `schedule`
Schedules a new task. Available options:
- `--type`: Task type (`http`)
- `--runAt`: Execution time (default: now)
- `--interval`: Repeat interval in ms (optional)
- `--priority`: Task priority (optional)
- `--retriesLeft`: Number of retry attempts (optional)
- `--webhookUrl`: Webhook URL for notifications (optional)

#### `delete <id>`
Deletes a task by its ID.

---

## HTTP Server

BlazerJob includes a built-in HTTP server (Fastify) for managing tasks via REST API.

### Starting the Server

```typescript
import { startServer } from 'blazerjob';

await startServer(9000); // Server runs on http://localhost:9000
```

### API Endpoints

- **GET /tasks**: List all scheduled tasks
- **POST /task**: Schedule a new task (JSON body with runAt, type, config, etc.)
- **DELETE /task/:id**: Delete a task by ID

> **Important**: The HTTP server uses **in-memory storage** by default. Tasks will be lost when the server restarts. For persistence, modify the server initialization to use `storage: 'sqlite'`.

### Example: Schedule via HTTP

```bash
curl -X POST http://localhost:9000/task \
  -H "Content-Type: application/json" \
  -d '{
    "runAt": "2025-01-01T00:00:00Z",
    "type": "http",
    "config": {
      "url": "https://api.example.com",
      "method": "GET"
    }
  }'
```

---

## Installation

```bash
npm install blazerjob
```

> Note: Installation can take a bit longer because BlazerJob pulls in blockchain SDKs and builds native SQLite bindings (`better-sqlite3`). If you’re on a fresh machine, ensure build tools are available (e.g., Python + a C/C++ compiler) before installing.

---

## Performance & tuning

- SQLite WAL enabled by default for file storage (`journal_mode = WAL`) to avoid reader/writer blocking (not applied to in-memory storage).
- Concurrency configured via `concurrency` option (default `1` for backward compatibility).
- Scheduler interval lowered to 50 ms + immediate drain when all slots are used.

Synthetic benchmarks (fake tasks, local NVMe) :

| Concurrency | Task duration | Observed throughput |
|-------------|---------------|---------------------|
| 16          | 50 ms         | ~31 tasks/s (with logs) |
| 32          | 50 ms         | ~544 tasks/s |
| 64          | 50 ms         | ~982 tasks/s |
| 64          | 10 ms         | ~1,156 tasks/s |
| 128         | 10 ms         | ~2,183 tasks/s |
| 256         | 10 ms         | ~3,096 tasks/s |
| 512         | 10 ms         | ~4,367 tasks/s |
| 1024        | 10 ms         | ~4,464 tasks/s |

Numbers depend heavily on CPU/I/O; tune `concurrency` to match your workload.

---

## Import

```typescript
import { BlazeJob } from 'blazerjob';
```

---

## Environment Variables & Secrets

BlazerJob uses [dotenv](https://github.com/motdotla/dotenv) to securely load secrets (like private keys and RPC URLs) from a `.env` file.

1. Copy `.env.example` to `.env` and fill in your secrets:

```bash
cp .env.example .env
```

Example `.env`:
```
COSMOS_MNEMONIC=0xYOUR_COSMOS_MNEMONIC
COSMOS_RPC_URL=https://mainnet.infura.io/v3/YOUR_INFURA_KEY
```

- **Never commit your real `.env` to version control!**
- You can omit `privateKey` and `rpcUrl` from the task config to use values from the environment.
- This pattern can be used for other secrets (API keys, fintech credentials, etc.) in custom handlers.

---

## API Reference

### `new BlazeJob(options: BlazeJobOptions)`
- **storage?**: Storage mode - `'memory'` (default, in-memory) or `'sqlite'` (persistent file storage)
- **dbPath?**: Path to the SQLite database file (only used when `storage: 'sqlite'`, defaults to `'blazerjob.db'`)
- **concurrency?**: Number of concurrent tasks to execute (default: `1`)
- **autoExit?**: Automatically exit process when all periodic tasks complete (default: `false`)
- **encryptionKey?**: Custom encryption key for task configs (default: uses `BLAZERJOB_ENCRYPTION_KEY` env var or a default key)

### schedule(taskFn: () => Promise<void>, opts: { ... }): number
- **taskFn**: Asynchronous function to execute (your JS/TS code).
- **opts**:
  - `runAt`: Date or ISO string for when to run the task.
  - `interval?`: (optional) Number of milliseconds between executions (for recurring tasks).
  - `priority?`: (optional) Higher priority tasks run first.
  - `retriesLeft?`: (optional) Number of retry attempts if the task fails.
  - `type`: Task type (e.g. `'http'`).
  - `config?`: (optional) Additional configuration for the task, see [TaskConfig](#taskconfig-interface) below.
  - `webhookUrl?`: (optional) If set, BlazerJob will POST a JSON payload to this URL on task success, failure, or retry.
  - `maxRuns?`: (optional) Maximum number of executions for periodic tasks.
  - `maxDurationMs?`: (optional) Maximum duration in milliseconds for periodic tasks.
  - `onEnd?`: (optional) Callback function called when task completes with stats `{ runCount, errorCount }`.

Returns the ID of the created task.

### start(): Promise<void>
- Starts the scheduler loop (automatically executes due tasks).

### stop(): void
- Stops the scheduler loop (does not close the database).

### deleteTask(taskId: number): void
- Deletes a task by ID and cleans up associated memory (task functions, stats, error counts).

### getTasks(): any[]
- Returns all tasks from the database with decrypted configurations.

---

## Automatic Process Exit (autoExit option)

For testing or scripting purposes, you can configure BlazeJob to automatically exit the process as soon as all periodic tasks (with `maxRuns` or `maxDurationMs`) are completed:

```typescript
const jobs = new BlazeJob({ dbPath: './test.db', autoExit: true });

jobs.schedule(async () => {}, {
  runAt: new Date(),
  interval: 2000,
  maxRuns: 3,
  onEnd: (stats) => {
    console.log('Summary:', stats);
  }
});

jobs.start();
// The process will automatically exit after the last periodic task is finished.
```

- If `autoExit` is not enabled, the process will continue running as usual.
- You can also use the global `onAllTasksEnded` callback to perform actions at the end, without stopping the process:

```typescript
jobs.onAllTasksEnded(() => {
  console.log('All periodic tasks are done.');
});
```

## Best Practices
- **Enable `autoExit` only for scripts or tests.**
- **In production/server, leave `autoExit` as `false` (the default) to prevent unexpected process termination.**

---

## TaskConfig Interface

BlazerJob supports the following task type and config structure:

```typescript
type TaskType = 'http';

interface HttpTaskConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
}
```

---

## Webhook Notifications

If you set `webhookUrl` when scheduling a task, BlazerJob will POST a JSON payload to that URL on task completion (success, failure, or retry).

### Example Payload (Success)
```json
{
  "taskId": 42,
  "status": "done",
  "executedAt": "2025-05-05T23:50:00Z",
  "result": "success",
  "output": null,
  "error": null
}
```

### Example Payload (Failure)
```json
{
  "taskId": 42,
  "status": "failed",
  "executedAt": "2025-05-05T23:51:00Z",
  "result": "error",
  "output": null,
  "error": "Command failed: ..."
}
```

### Example Payload (Retry)
```json
{
  "taskId": 42,
  "status": "pending",
  "executedAt": "2025-05-05T23:52:00Z",
  "result": "retry",
  "output": null,
  "error": "Temporary error message"
}
```

---

## Example: Scheduled HTTP request (http connector)

BlazerJob now lets you schedule an HTTP API request (using fetch):

### Example: simple POST request
```typescript
import { BlazeJob } from 'blazerjob';

const jobs = new BlazeJob({ dbPath: './tasks.db' });

jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'http',
  config: JSON.stringify({
    url: 'https://httpbin.org/post',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { hello: 'world' }
  })
});

jobs.start();
```

### Example: GET Request
```typescript
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'http',
  config: JSON.stringify({
    url: 'https://api.coindesk.com/v1/bpi/currentprice.json',
    method: 'GET'
  })
});
```

### Example: GET Request Every 10 Seconds with Response Logging

```typescript
import { BlazeJob } from 'blazerjob';

const jobs = new BlazeJob({ dbPath: './tasks.db' });

jobs.schedule(async () => {}, {
  runAt: new Date(),
  interval: 10000, // every 10 seconds
  type: 'http',
  config: JSON.stringify({
    url: 'https://api.coindesk.com/v1/bpi/currentprice.json',
    method: 'GET'
  })
});

jobs.start();
```

> To log the response on the server side, modify the function in the source code:
>
> ```typescript
> taskFn = async () => {
>   const res = await fetch(cfg.url, {
>     method: cfg.method ?? 'POST',
>     headers: cfg.headers,
>     body: cfg.body ? JSON.stringify(cfg.body) : undefined
>   });
>   const text = await res.text();
>   console.log('[HTTP][response]', text);
> };
> ```

---

## License

GNU
