# BlazerJob

BlazerJob is a Node.js/TypeScript library for scheduling, executing, and managing asynchronous tasks, with simple SQLite persistence. You can schedule any JavaScript/TypeScript function, HTTP requests, or blockchain (Cosmos) queries and transactions.

# Supported Connectors

BlazeJob currently supports only the following connectors for actual execution:

| Connector Type | Status         | Description                                                      |
|---------------|---------------|------------------------------------------------------------------|
| `cosmos`      | Supported     | Send tokens, query balances/transactions, batch Cosmos queries    |
| `http`        | Supported     | Generic HTTP requests (GET, POST, etc.)                          |
| `shell`       | Not supported | Present in types, but not executed (ignored/logged only)         |
| `onchain`     | Not supported | Present in types, but not executed (ignored/logged only)         |
| `solana`      | Not supported | Present in types, but not executed (ignored/logged only)         |
| `email`       | Not supported | Present in types, but not executed (ignored/logged only)         |
| `fintech`     | Not supported | Present in types, but not executed (ignored/logged only)         |

> Only tasks of type `cosmos` and `http` are actually executed by BlazeJob. All other types are reserved for future extensions or compatibility, but are currently ignored or simply logged by the server.

## 1. Custom Tasks (Arbitrary JavaScript/TypeScript)

BlazeJob can schedule and execute any custom asynchronous JavaScript/TypeScript function. This is the most flexible way to use the scheduler, and is ideal for business logic, scripts, or workflows that don't fit a predefined connector.

### Example: Custom Task
```typescript
const jobs = new BlazeJob({ dbPath: './tasks.db' });

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

---

## 2. HTTP Tasks (API Calls)

BlazeJob natively supports HTTP tasks for scheduling API calls (GET, POST, etc.).

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
=======
---

## Table of Contents
- [Overview](#overview)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [Advanced Use Cases](#advanced-use-cases)
- [API](#api)
- [Configuration & Environment Variables](#configuration--environment-variables)
- [CLI](#cli)
- [Contributing](#contributing)
- [License](#license)

---

## Overview
BlazerJob lets you schedule and execute jobs reliably—even after a restart. Currently, only the Cosmos connector (Cosmos blockchain) is supported. Other job types (HTTP, Shell, Email, etc.) are disabled or not maintained.

---

## Installation

```bash
npm install blazerjob
```

---

## Getting Started

### 1. Import and initialize
```typescript
import { BlazeJob } from 'blazerjob';
const jobs = new BlazeJob({ dbPath: './tasks.db' });
```

### 2. Schedule a custom (arbitrary) task
```typescript
jobs.schedule(async () => {
  console.log('Hello from my custom task!');
  // Any JS/TS code here
}, {
  runAt: new Date(),
  type: 'custom'
});
```

### 3. Schedule an HTTP task
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


```typescript
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'cosmos',
  config: JSON.stringify({
    queryType: 'balance',
    queryParams: { address: 'cosmos1...' }
  })
});
```


### Example: Send Cosmos Tokens
### 5. Start the scheduler
```typescript
await jobs.start();
```

---

## Stopping Tasks and the Scheduler

To stop the scheduler and prevent further task execution, simply call:

```typescript
jobs.stop();
```

- This will stop the internal timer and no more scheduled tasks will run until you call `start()` again.
- If you use recurring (interval) tasks, you can stop them at any time with `jobs.stop()`.
- For CLI or server usage, you can also handle process signals (SIGINT/SIGTERM) to stop gracefully.
- If the `autoExit` option is enabled, BlazerJob will automatically exit the process when all periodic tasks are done.

---

## Advanced Use Cases

### Send Cosmos tokens

```

## Required Environment Variables
- `COSMOS_MNEMONIC` – Cosmos mnemonic
- `COSMOS_RPC_URL` – Cosmos RPC endpoint

## Other Task Types
Any type other than `cosmos` (e.g., `shell`, `onchain`, `solana`, `email`, `fintech`, `http`) will be ignored and simply logged. To extend, you will need to reactivate or develop the corresponding connector.
=======
### Batch Cosmos queries
```typescript
import { scheduleManyCosmosQueries } from './src/cosmos';
await scheduleManyCosmosQueries(jobs, {
  addresses: ['cosmos1...', 'cosmos1...'],
  count: 100,
  queryType: 'balance',
  intervalMs: 100,
});
```

### Use Cosmos helpers directly
```typescript
import { getBalance, sendTokens } from './src/cosmos';
const balance = await getBalance(process.env.COSMOS_RPC_URL, 'cosmos1...');
await sendTokens({
  rpcUrl: process.env.COSMOS_RPC_URL,
  mnemonic: process.env.COSMOS_MNEMONIC,
  to: 'cosmos1...',
  amount: '100000',
  denom: 'uatom',
  chainId: 'cosmoshub-4',
});
```


---

## API

### Main Methods
- `schedule(fn, options)`: Add a job to execute at a specific date/time.
- `start()`: Start the scheduler (automatically executes due jobs).
- `stop()`: Stop the scheduler.

### Cosmos Helpers (in `src/cosmos/`)
- `getBalance(rpcUrl, address)`: Get an address balance
- `getTx(rpcUrl, hash)`: Get transaction details
- `sendTokens({rpcUrl, mnemonic, to, amount, denom, ...})`: Send tokens
- `scheduleManyCosmosQueries(jobs, { ... })`: Batch queries

---

## Configuration & Environment Variables

BlazerJob uses [dotenv](https://github.com/motdotla/dotenv). Copy `.env.example` to `.env` and fill in your secrets:

- `COSMOS_MNEMONIC`: Cosmos mnemonic
- `COSMOS_RPC_URL`: Cosmos RPC endpoint

---

## CLI

BlazerJob provides a CLI to manage your jobs:

```bash
npx ts-node src/bin/cli.ts help        # Help
npx ts-node src/bin/cli.ts schedule   # Schedule a job
npx ts-node src/bin/cli.ts list       # List jobs
npx ts-node src/bin/cli.ts list-all   # List jobs in all .db files
npx ts-node src/bin/cli.ts delete ID  # Delete a job
```

---

## Contributing

PRs are welcome! Please document your code and add tests if possible.

---

## License

MIT

├─────────┼────┼──────────┼────────────────────────────┼──────────┼─────────────────────────────────────┤
│    0    │ 42 │ 'cosmos' │ '2025-05-06T02:21:28.275Z' │ 'failed' │ '{"queryType":"balance",...}'     │
└─────────┴────┴──────────┴────────────────────────────┴──────────┴─────────────────────────────────────┘
```

#### `list`
Shows tasks only from the default database (`blazerjob.db`).

#### `schedule`
Schedules a new task. Available options:
- `--type`: Task type (`cosmos`)
- `--cmd`: Command to execute (for cosmos tasks)
- `--runAt`: Execution time (default: now)
- `--interval`: Repeat interval in ms (optional)
- `--priority`: Task priority (optional)
- `--retriesLeft`: Number of retry attempts (optional)
- `--webhookUrl`: Webhook URL for notifications (optional)

#### `delete <id>`
Deletes a task by its ID.

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

## Environment Variables & Secrets

BlazeJob uses [dotenv](https://github.com/motdotla/dotenv) to securely load secrets (like private keys and RPC URLs) from a `.env` file.

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

### `new BlazeJob(options: { dbPath: string })`
- **dbPath**: Path to the SQLite database file where tasks are stored.

### schedule(taskFn: () => Promise<void>, opts: { ... }): number
- **taskFn**: Asynchronous function to execute (your JS/TS code).
- **opts**:
  - `runAt`: Date or ISO string for when to run the task.
  - `interval?`: (optional) Number of milliseconds between executions (for recurring tasks).
  - `priority?`: (optional) Higher priority tasks run first.
  - `retriesLeft?`: (optional) Number of retry attempts if the task fails.
  - `type`: Task type (e.g. `'cosmos'`).
  - `config?`: (optional) Additional configuration for the task, see [TaskConfig](#taskconfig-interface) below.
  - `webhookUrl?`: (optional) If set, BlazeJob will POST a JSON payload to this URL on task success, failure, or retry.

Returns the ID of the created task.

### start(): Promise<void>
- Starts the scheduler loop (automatically executes due tasks).

### stop(): void
- Stops the scheduler loop (does not close the database).

---

## Arrêt automatique du process (option autoExit)

Pour les cas de test ou de script, vous pouvez demander à BlazeJob de couper le process automatiquement dès que toutes les tâches périodiques (avec `maxRuns` ou `maxDurationMs`) sont terminées :

```typescript
const jobs = new BlazeJob({ dbPath: './test.db', autoExit: true });

jobs.schedule(async () => {}, {
  runAt: new Date(),
  interval: 2000,
  maxRuns: 3,
  onEnd: (stats) => {
    console.log('Résumé :', stats);
  }
});

jobs.start();
// Le process s'arrêtera automatiquement à la fin de la dernière tâche périodique.
```

- Si `autoExit` n'est pas activé, le process continue de tourner normalement.
- Vous pouvez aussi utiliser le callback global `onAllTasksEnded` pour effectuer des actions à la fin, sans arrêter le process :

```typescript
jobs.onAllTasksEnded(() => {
  console.log('Toutes les tâches périodiques sont terminées.');
});
```

## Bonnes pratiques
- **N'activez `autoExit` que pour les scripts ou les tests.**
- **En production/server, laissez `autoExit` à `false` (par défaut) pour éviter tout arrêt inopiné du process.**

---

## TaskConfig Interface

BlazeJob supports the following task types and config structures:

```typescript
type TaskType = 'cosmos';

interface CosmosTaskConfig {
  queryType: 'balance' | 'tx' | 'custom';
  queryParams?: Record<string, string>;
  to?: string;
  amount?: string;
  denom?: string;
  mnemonic?: string;
  chainId?: string;
  rpcUrl?: string;
}
```

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

## Exemple : requête simple Cosmos (balance ou tx)

Voici comment utiliser BlazeJob pour exécuter une requête simple sur Cosmos (par exemple, obtenir le solde d'une adresse ou les infos d'une transaction) :

### 1. Query balance (solde)
```typescript
import { BlazeJob } from 'blazerjob';

const jobs = new BlazeJob({ dbPath: './tasks.db' });

jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'cosmos',
  config: JSON.stringify({
    queryType: 'balance',
    queryParams: { address: 'cosmos1...' },
    // rpcUrl peut venir de .env ou être spécifié ici
  })
});

jobs.start();
```

### 2. Query transaction (tx)
```typescript
import { BlazeJob } from 'blazerjob';

const jobs = new BlazeJob({ dbPath: './tasks.db' });

jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'cosmos',
  config: JSON.stringify({
    queryType: 'tx',
    queryParams: { hash: '0x...' },
    // rpcUrl peut venir de .env ou être spécifié ici
  })
});

jobs.start();
```

- Les résultats sont loggés côté serveur (console).
- Pour une requête personnalisée, utilise `queryType: 'custom'` et adapte `queryParams` selon tes besoins.

---

## Exemple : requête HTTP planifiée (connecteur http)

BlazeJob permet désormais de planifier une requête API HTTP (fetch) :

### Exemple : requête POST simple
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

### Exemple : requête GET
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

### Exemple : requête GET toutes les 10 secondes avec log de la réponse

```typescript
import { BlazeJob } from 'blazerjob';

const jobs = new BlazeJob({ dbPath: './tasks.db' });

jobs.schedule(async () => {}, {
  runAt: new Date(),
  interval: 10000, // toutes les 10 secondes
  type: 'http',
  config: JSON.stringify({
    url: 'https://api.coindesk.com/v1/bpi/currentprice.json',
    method: 'GET'
  })
});

jobs.start();
```

> Pour logguer la réponse côté serveur, modifie la fonction dans le code source :
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

## Cosmos Module: Centralized Logic

BlazeJob centralizes all Cosmos blockchain logic in the `src/cosmos/` module. This module exposes helpers for scheduling, querying, and sending tokens on Cosmos chains (CosmJS-compatible).

### Features
- **Batch scheduling**: Schedule hundreds of Cosmos queries or transactions in one call.
- **Unified helpers**: Query balances, transactions, and send tokens using a simple API.
- **Environment support**: Cosmos mnemonic and RPC URL can be set in `.env` or provided per task.
- **Error handling**: Centralized error helpers for Cosmos-specific issues (rate limits, etc).
- **TypeScript-first**: All helpers are typed for safe use.

### Example: Batch Cosmos Queries
```typescript
import { BlazeJob } from 'blazerjob';
import { scheduleManyCosmosQueries } from './src/cosmos';

const job = new BlazeJob({ dbPath: './tasks.db' });

await scheduleManyCosmosQueries(job, {
  addresses: [
    'cosmos1fl48vsnmsdzcv85q5d2q4z5ajdha8yu34mf0eh',
    'cosmos1c9ye9j3p4e9w8f7j2k7l6k8e8f7g9h5d3j8k7h',
  ],
  count: 100,
  queryType: 'balance',
  intervalMs: 100,
});
job.start();
```

### Example: Query Cosmos Balance or Transaction
```typescript
import { getBalance, getTx } from './src/cosmos';

const balances = await getBalance(process.env.COSMOS_RPC_URL, 'cosmos1...');
const tx = await getTx(process.env.COSMOS_RPC_URL, '0x...');
```

### Example: Send Tokens on Cosmos
```typescript
import { sendTokens } from './src/cosmos';

await sendTokens({
  rpcUrl: process.env.COSMOS_RPC_URL,
  mnemonic: process.env.COSMOS_MNEMONIC,
  to: 'cosmos1destination...',
  amount: '100000',
  denom: 'uatom',
  chainId: 'cosmoshub-4',
});
```

### Environment Variables
- `COSMOS_MNEMONIC` – Cosmos wallet mnemonic
- `COSMOS_RPC_URL` – Cosmos RPC endpoint

See `.env.example` for details.

---

## Cosmos Helpers (API)

BlazeJob exposes various Cosmos helpers in `src/cosmos/queries.ts`:

- `getBalance(rpcUrl, address)`: Gets the balance of an address
- `getTx(rpcUrl, hash)`: Retrieves a transaction by hash
- `sendTokens({rpcUrl, mnemonic, to, amount, denom, ...})`: Sends ATOM or other tokens
- `getLatestBlockHeight(rpcUrl)`: Gets the latest block height
- `getBlockByHeight(rpcUrl, height)`: Gets block details by height
- `getAccountInfo(rpcUrl, address)`: Gets account info (account number, sequence, ...)
- `getAllBalances(rpcUrl, address)`: Gets all balances for an address
- `getChainId(rpcUrl)`: Gets the chain ID
- `getTransactionByHash(rpcUrl, hash)`: Alias for `getTx`
- `searchTxs(rpcUrl, query)`: Searches transactions (by address, event, ...)
- `broadcastTx(rpcUrl, txBytes)`: Broadcasts a signed transaction
- `getDelegation(rpcUrl, delegator, validator)`: Gets specific staking delegation

> Some advanced queries (validators, supply, node info) require a REST/LCD endpoint (not included in StargateClient, see cosmjs/launchpad/lcd or fetch).

#### Advanced Usage Example
```typescript
import {
  getBalance, getTx, sendTokens, getLatestBlockHeight, getBlockByHeight,
  getAccountInfo, getAllBalances, getChainId, getTransactionByHash, searchTxs,
  broadcastTx, getDelegation
} from './src/cosmos';

const balances = await getAllBalances(process.env.COSMOS_RPC_URL, 'cosmos1...');
const block = await getBlockByHeight(process.env.COSMOS_RPC_URL, 1234567);
const delegation = await getDelegation(process.env.COSMOS_RPC_URL, 'cosmos1delegator...', 'cosmosvaloper1validator...');
```

---

## License

MIT