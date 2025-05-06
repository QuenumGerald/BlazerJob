# BlazeJob – Task Scheduler Library

**BlazeJob** is a lightweight, SQLite-backed task scheduler for Node.js and TypeScript applications.
Use it as a library in your code to schedule, execute, and manage asynchronous tasks.

## 🚀 Quick Start

### Installation
```bash
npm install blazerjob
# or
yarn add blazerjob
```

### Basic Example
```typescript
import { BlazeJob } from 'blazerjob';

// Initialize with SQLite database
const jobs = new BlazeJob({ dbPath: './tasks.db' });

// Schedule a simple task
jobs.schedule(async () => {
  console.log('Task executed at', new Date().toISOString());
}, { 
  runAt: new Date(Date.now() + 5000), // Run in 5 seconds
  type: 'custom',
  config: { note: 'My first task' }
});

// Start the scheduler
jobs.start();
```

### Cosmos Example
```typescript
import { scheduleManyCosmosQueries } from 'blazerjob/cosmos';

// Schedule multiple Cosmos queries
await scheduleManyCosmosQueries(job, {
  addresses: ['cosmos1...', 'cosmos1...'],
  count: 10,
  queryType: 'balance',
  intervalMs: 1000,
  webhookUrl: 'https://your-webhook.com/endpoint'
});
```

## CLI

BlazeJob provides a CLI to easily manage your scheduled tasks:

```bash
# Show help
npx ts-node src/bin/cli.ts help

# Schedule a task (e.g., shell)
npx ts-node src/bin/cli.ts schedule --type shell --cmd "echo hello" --runAt "2025-01-01T00:00:00Z"

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
│    0    │ 1  │ 'shell' │ '2025-05-05T21:24:13.727Z' │ 'failed' │ '{"cmd":"echo test"}'       │
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
- `--type`: Task type (`shell`, `cosmos`, etc.)
- `--cmd`: Command to execute (for shell tasks)
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
PRIVATE_KEY=0xYOUR_PRIVATE_KEY
RPC_URL=https://mainnet.infura.io/v3/YOUR_INFURA_KEY
```

- **Never commit your real `.env` to version control!**
- You can omit `privateKey` and `rpcUrl` from the task config to use values from the environment.
- This pattern can be used for other secrets (API keys, fintech credentials, etc.) in custom handlers.

### Example: Schedule an ETH Transfer using dotenv

```typescript
jobs.schedule(async () => {}, {
  runAt: new Date(Date.now() + 10000),
  type: 'onchain',
  config: JSON.stringify({
    to: '0xRecipientAddress',
    value: '0.01' // ETH
    // rpcUrl and privateKey will be read from process.env
  })
});
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
  - `type`: Task type (e.g. `'custom'`, `'shell'`, `'onchain'`, `'http'`, `'fintech'`).
  - `config?`: (optional) Additional configuration for the task, see [TaskConfig](#taskconfig-interface) below.
  - `webhookUrl?`: (optional) If set, BlazeJob will POST a JSON payload to this URL on task success, failure, or retry.

Returns the ID of the created task.

### start(): Promise<void>
- Starts the scheduler loop (automatically executes due tasks).

### stop(): void
- Stops the scheduler loop (does not close the database).

---

## TaskConfig Interface

BlazeJob supports the following task types and config structures:

```typescript
type TaskType = 'fintech' | 'onchain' | 'shell' | 'http';

interface ShellTaskConfig {
  cmd: string;
}

interface HttpTaskConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
}

interface OnchainTaskConfig {
  rpcUrl?: string; // can be omitted if set in .env
  privateKey?: string; // can be omitted if set in .env
  to: string;
  value: string; // in ETH or wei
  data?: string;
  gasLimit?: number;
}

interface FintechTaskConfig {
  provider: string;
  amount: number;
  currency: string;
  recipient: string;
  // ...other fields as needed
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

## Quickstart: Send an ETH Transaction (Web3)

BlazeJob supports onchain tasks using Ethers.js. You can schedule a transaction to be sent on Ethereum (or compatible chains).

### Example: Schedule an ETH Transfer

```typescript
jobs.schedule(async () => {}, {
  runAt: new Date(Date.now() + 10000), // 10 seconds from now
  type: 'onchain',
  config: JSON.stringify({
    rpcUrl: 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY',
    privateKey: '0xYOUR_PRIVATE_KEY',
    to: '0xRecipientAddress',
    value: '0.01' // ETH
  })
});
```

- `rpcUrl`: JSON-RPC endpoint (Infura, Alchemy, etc.)
- `privateKey`: Sender's private key (keep secure!)
- `to`: Recipient address
- `value`: Amount in ETH (can be a string or number)
- Optional: `data`, `gasLimit`

BlazeJob will send the transaction and wait for confirmation. You can also use webhooks to be notified on success/failure.

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
- Store all secrets and credentials in your `.env` file, never in source code or version control.

---

## Extending BlazeJob

- You can integrate BlazeJob into any Node.js/TypeScript backend (Fastify, Express, etc).
- To support additional task types, extend the logic in the `tick()` method to handle new types and configs.
- For FinTech or Web3 connectors, use environment variables for credentials and document them in `.env.example`.

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

## Solana & Email Connectors

BlazeJob supports Solana and Email tasks. Use environment variables to secure your secrets (see `.env.example`).

### Example: Solana Transfer
```typescript
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'solana',
  config: JSON.stringify({
    to: 'SolanaRecipient',
    lamports: 1000000 // 0.001 SOL
    // secretKey and rpcUrl can come from .env
  })
});
```

- Required variables in `.env`:
  - `SOLANA_SECRET_KEY` (base58 secret key)
  - `SOLANA_RPC_URL` (Solana endpoint)

### Example: Sending Email
```typescript
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'email',
  config: JSON.stringify({
    to: 'user@example.com',
    subject: 'Hello!',
    text: 'This is a test email.'
    // smtpUser, smtpPass, etc. can come from .env
  })
});
```

- Required variables in `.env`:
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`

See `.env.example` for the complete list of variables and expected structure.

---

## Cosmos (CosmJS) Connector

BlazeJob supports Cosmos tasks via CosmJS. You can send tokens or query the Cosmos blockchain (or any Stargate-compatible chain).

### Example: Sending ATOM Tokens
```typescript
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'cosmos',
  config: JSON.stringify({
    to: 'cosmos1destination...',
    amount: '100000', // in uatom
    denom: 'uatom',
    chainId: 'cosmoshub-4'
    // mnemonic and rpcUrl can come from .env
  })
});
```

- Required variables in `.env`:
  - `COSMOS_MNEMONIC` (wallet mnemonic phrase)
  - `COSMOS_RPC_URL` (Cosmos RPC endpoint)

### Example: Balance or Transaction Query
```typescript
// Query balance
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'cosmos',
  config: JSON.stringify({
    queryType: 'balance',
    queryParams: { address: 'cosmos1...' }
    // rpcUrl can come from .env
  })
});

// Query transaction
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'cosmos',
  config: JSON.stringify({
    queryType: 'tx',
    queryParams: { hash: '0x...' }
    // rpcUrl can come from .env
  })
});
```

- Query results are currently logged server-side (adapt as needed).
- For other queries, use `queryType: 'custom'` and provide the necessary parameters.

See `.env.example` for the exact structure of Cosmos variables.

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