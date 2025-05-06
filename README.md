# BlazeJob – Task Scheduler Library

**BlazeJob** is a lightweight, SQLite-backed task scheduler for Node.js and TypeScript applications.
You can use it as a library in your own code to schedule, execute, and manage asynchronous tasks. Supports HTTP webhooks for notification on task completion or failure.

---

## Installation

```bash
npm install blazerjob
```

---

## Import

```typescript
import { BlazeJob } from 'blazerjob';
```

---

## Basic Usage

```typescript
const jobs = new BlazeJob({ dbPath: './mytasks.db' });

// Schedule a custom JS/TS function
jobs.schedule(async () => {
  console.log('Hello from my app!');
}, { runAt: new Date(Date.now() + 5000), type: 'custom' });

// Start the scheduler
jobs.start();
```

---

## API Reference

### `new BlazeJob(options: { dbPath: string })`
- **dbPath**: Path to the SQLite database file where tasks are stored.

### schedule(taskFn: () => Promise<void>, opts: { ... }): number
- **taskFn**: Asynchronous function to execute (your JS/TS code).
- **opts**:
  - `runAt`: Date or ISO string for when to run the task.
  - `interval?`: (optional) Number of milliseconds between executions (for recurring tasks).
  - `priority?`: (optional) Higher priority tasks run first.
  - `retriesLeft?`: (optional) Number of retry attempts if the task fails.
  - `type`: Task type (e.g. `'custom'`, `'shell'`, etc.).
  - `config?`: (optional) Additional configuration for the task.
  - `webhookUrl?`: (optional) If set, BlazeJob will POST a JSON payload to this URL on task success, failure, or retry.

Returns the ID of the created task.

### start(): Promise<void>
- Starts the scheduler loop (automatically executes due tasks).

### stop(): void
- Stops the scheduler loop (does not close the database).

---

## Webhook Notifications

If you set `webhookUrl` when scheduling a task, BlazeJob will POST a JSON payload to that URL on task completion (success, failure, or retry).

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

## Advanced Examples

### Recurring Task Every 10 Seconds

```typescript
jobs.schedule(async () => {
  // Your recurring logic here
}, { runAt: new Date(), interval: 10000, type: 'custom' });
```

### Custom Task with Retry

```typescript
jobs.schedule(async () => {
  // Some operation that might fail
}, { runAt: new Date(), retriesLeft: 3, type: 'custom' });
```

### Task with Webhook

```typescript
jobs.schedule(async () => {
  // ...
}, {
  runAt: new Date(),
  type: 'custom',
  webhookUrl: 'https://webhook.site/your-url'
});
```

---

## Best Practices

- Call `jobs.start()` only once per process.
- Use a unique SQLite database path per BlazeJob instance.
- For multi-process/task-distributed setups, consider exposing BlazeJob via an HTTP API.

---

## Extending BlazeJob

- You can integrate BlazeJob into any Node.js/TypeScript backend (Fastify, Express, etc).
- To support additional task types, extend the logic in the `tick()` method to handle new types and configs.

---

## Example: Integrating BlazeJob in Your Project

```typescript
import { BlazeJob } from 'blazerjob';

const jobs = new BlazeJob({ dbPath: './tasks.db' });

jobs.schedule(async () => {
  console.log('This runs 5 seconds after startup!');
}, { runAt: new Date(Date.now() + 5000), type: 'custom' });

jobs.start();
```

---

## CLI (Optional)

BlazeJob also provides a CLI for quick task scheduling and management. After installing globally:

```bash
npm install -g blazerjob
```

You can use:

```bash
blazerjob schedule --type shell --cmd "echo hello" --webhookUrl "https://webhook.site/your-url"
blazerjob list
blazerjob delete <id>
```

The CLI works with the same SQLite database as the library.

---

## License

MIT