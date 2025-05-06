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

## Solana & Email Connectors

BlazeJob prend en charge les tâches Solana et Email. Utilisez les variables d'environnement pour sécuriser vos secrets (voir `.env.example`).

### Exemple : Transfert Solana
```typescript
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'solana',
  config: JSON.stringify({
    to: 'DestinataireSolana',
    lamports: 1000000 // 0.001 SOL
    // secretKey et rpcUrl peuvent venir du .env
  })
});
```

- Variables requises dans `.env` :
  - `SOLANA_SECRET_KEY` (clé secrète base58)
  - `SOLANA_RPC_URL` (endpoint Solana)

### Exemple : Envoi d'Email
```typescript
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'email',
  config: JSON.stringify({
    to: 'user@example.com',
    subject: 'Hello!',
    text: 'Ceci est un test.'
    // smtpUser, smtpPass, etc. peuvent venir du .env
  })
});
```

- Variables requises dans `.env` :
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`

Voir `.env.example` pour le détail des variables et la structure attendue.

---

## Cosmos (CosmJS) Connector

BlazeJob prend en charge les tâches Cosmos via CosmJS. Vous pouvez envoyer des tokens ou interroger la blockchain Cosmos (ou toute chaîne compatible Stargate).

### Exemple : Envoi de tokens ATOM
```typescript
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'cosmos',
  config: JSON.stringify({
    to: 'cosmos1destination...',
    amount: '100000', // en uatom
    denom: 'uatom',
    chainId: 'cosmoshub-4'
    // mnemonic et rpcUrl peuvent venir du .env
  })
});
```

- Variables requises dans `.env` :
  - `COSMOS_MNEMONIC` (phrase mnémonique du wallet)
  - `COSMOS_RPC_URL` (endpoint RPC Cosmos)

### Exemple : Requête balance ou transaction
```typescript
// Query balance
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'cosmos',
  config: JSON.stringify({
    queryType: 'balance',
    queryParams: { address: 'cosmos1...' }
    // rpcUrl peut venir du .env
  })
});

// Query transaction
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'cosmos',
  config: JSON.stringify({
    queryType: 'tx',
    queryParams: { hash: '0x...' }
    // rpcUrl peut venir du .env
  })
});
```

- Les résultats des queries sont actuellement loggés côté serveur (adaptez selon vos besoins).
- Pour d'autres queries, utilisez `queryType: 'custom'` et fournissez les paramètres nécessaires.

Voir `.env.example` pour la structure exacte des variables Cosmos.

---

## License

MIT