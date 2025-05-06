# BlazeJob – Task Scheduler Library

**BlazeJob** is a lightweight, SQLite-backed task scheduler for Node.js and TypeScript applications.
Use it as a library in your code to schedule, execute, and manage asynchronous tasks.

# ⚠️ Connecteurs supportés

Depuis la version actuelle, **BlazeJob** ne supporte plus que le connecteur Cosmos. Tous les autres connecteurs (Solana, Onchain/Ethereum, Email, HTTP, Shell, Fintech) sont désactivés ou non maintenus. Toute tâche autre que Cosmos sera simplement loggée côté serveur, sans effet réel.

## Cosmos uniquement

- **Type accepté** : `cosmos`
- **Fonctionnalités** :
  - Envoi de tokens (sendTokens)
  - Requêtes de solde (balance), transactions (tx), et requêtes personnalisées (custom)
  - Batch de requêtes Cosmos via `scheduleManyCosmosQueries`

### Exemple de tâche Cosmos
```typescript
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'cosmos',
  config: JSON.stringify({
    queryType: 'balance',
    queryParams: { address: 'cosmos1...' }
    // rpcUrl peut venir de .env
  })
});
```

### Exemple d'envoi de tokens Cosmos
```typescript
jobs.schedule(async () => {}, {
  runAt: new Date(),
  type: 'cosmos',
  config: JSON.stringify({
    to: 'cosmos1...',
    amount: '100000',
    denom: 'uatom',
    mnemonic: process.env.COSMOS_MNEMONIC,
    chainId: 'cosmoshub-4',
    rpcUrl: process.env.COSMOS_RPC_URL
  })
});
```

## Variables d'environnement nécessaires
- `COSMOS_MNEMONIC` – Mnemonic Cosmos
- `COSMOS_RPC_URL` – Endpoint RPC Cosmos

## Autres types de tâches
Tout type autre que `cosmos` (ex: `shell`, `onchain`, `solana`, `email`, `fintech`, `http`) sera ignoré et simplement loggé. Pour toute extension, il faudra réactiver ou développer le connecteur correspondant.

## CLI

BlazeJob provides a CLI to easily manage your scheduled tasks:

```bash
# Show help
npx ts-node src/bin/cli.ts help

# Schedule a task (e.g., shell)
npx ts-node src/bin/cli.ts schedule --type cosmos --cmd "echo hello" --runAt "2025-01-01T00:00:00Z"

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