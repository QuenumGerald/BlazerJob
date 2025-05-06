import * as dotenv from 'dotenv';
dotenv.config();

import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
// @ts-ignore
const Database = require('better-sqlite3');
import fetch from 'node-fetch'; // si node <18
import { TaskType, TaskConfig, ShellTaskConfig, HttpTaskConfig, OnchainTaskConfig, FintechTaskConfig } from './types';
import { ethers } from 'ethers';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as nodemailer from 'nodemailer';
import * as bs58 from 'bs58';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningStargateClient, StargateClient, coins } from '@cosmjs/stargate';
import { makeCosmosTaskFn } from './cosmos/queries';

export class BlazeJob {
  private db: any;
  private timer?: NodeJS.Timeout;

  constructor(options: { dbPath: string }) {
    this.db = new Database(options.dbPath);
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        runAt DATETIME NOT NULL,
        interval INTEGER,
        priority INTEGER DEFAULT 0,
        retriesLeft INTEGER DEFAULT 0,
        type TEXT NOT NULL,
        config TEXT,
        webhookUrl TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        executed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        lastError TEXT
      )
    `).run();
    try {
      this.db.prepare('ALTER TABLE tasks ADD COLUMN lastError TEXT').run();
    } catch (e) {
      // Ignore si déjà présent
    }
    try {
      this.db.prepare('ALTER TABLE tasks ADD COLUMN webhookUrl TEXT').run();
    } catch (e) {
      // Ignore si déjà présent
    }
  }

  public async start() {
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), 500);
    }
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick() {
    // console.log('[BlazeJob] tick');
    type TaskRow = {
      id: number;
      runAt: string;
      interval: number | null;
      priority: number;
      retriesLeft: number;
      type: string;
      config: string | null;
      webhookUrl: string | null;
      status: string;
      executed_at: string | null;
      created_at: string;
      lastError: string | null;
    };
    const now = new Date().toISOString();
    const selectStmt = this.db.prepare(`
      SELECT * FROM tasks
      WHERE runAt <= @now AND status = 'pending'
      ORDER BY priority DESC, runAt ASC
    `);
    const dueTasks = selectStmt.all({ now }) as TaskRow[];

    for (const task of dueTasks) {
      if (task.type === 'cosmos' && task.config) {
        console.log('[BlazeJob] tâche Cosmos détectée', task);
      }
      // Mark as running
      this.db.prepare(`UPDATE tasks SET status = 'running' WHERE id = ?`).run(task.id);
      let taskFn: () => Promise<void>;
      try {
        console.log('[BlazeJob] Début construction taskFn pour la tâche', task.id, 'type:', task.type);
        if (task.type === 'cosmos') {
          const config = typeof task.config === 'string' ? JSON.parse(task.config) : task.config;
          console.log('[BlazeJob] Config Cosmos parsée pour la tâche', task.id, config);
          let configCopy = JSON.parse(JSON.stringify(config)); // clonage profond
          if (typeof configCopy === 'string') {
            configCopy = JSON.parse(configCopy);
          }
          taskFn = makeCosmosTaskFn(configCopy);
          console.log('[BlazeJob] taskFn Cosmos construit pour la tâche', task.id);
        } else {
          console.log('[BlazeJob] Tâche non Cosmos, type:', task.type, 'id:', task.id);
          taskFn = async () => {};
        }
        console.log('[BlazeJob] Avant exécution de taskFn pour la tâche', task.id);
        await taskFn();
        console.log('[BlazeJob] Après exécution de taskFn pour la tâche', task.id);
        this.db.prepare(`UPDATE tasks SET status = 'success', executed_at = ? WHERE id = ?`).run(new Date().toISOString(), task.id);
      } catch (err) {
        console.error('[BlazeJob] Erreur lors de l\'exécution de la tâche', task.id, err);
        // --- Ajout gestion retry ---
        if (task.retriesLeft && task.retriesLeft > 0) {
          // Décalage du prochain essai avec un backoff exponentiel simple
          const baseDelay = 2000; // 2 secondes de base
          const retryCount = (typeof task.retriesLeft === 'number') ? task.retriesLeft : 0;
          const nextDelay = baseDelay * Math.pow(2, Math.max(0, 3 - retryCount)); // Plus il reste de retries, plus le backoff est court
          const nextRunAt = new Date(Date.now() + nextDelay).toISOString();
          this.db.prepare(`UPDATE tasks SET status = 'pending', runAt = ?, retriesLeft = retriesLeft - 1, lastError = ? WHERE id = ?`).run(nextRunAt, String(err), task.id);
          console.warn(`[BlazeJob] Retry de la tâche ${task.id} dans ${nextDelay}ms (retriesLeft=${task.retriesLeft - 1})`);
        } else {
          this.db.prepare(`UPDATE tasks SET status = 'failed', lastError = ? WHERE id = ?`).run(String(err), task.id);
        }
        // --- Fin ajout gestion retry ---
      }
    }
  }

  static async sendWebhook(url: string, payload: any) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      // Optionnel : log ou ignorer
    }
  }

  /**
   * Programme nativement plusieurs requêtes Cosmos d'un coup.
   * @param opts
   *   - count: nombre de requêtes à programmer
   *   - address: adresse Cosmos cible
   *   - queryType: type de requête ('balance', 'tx', ...)
   *   - intervalMs: intervalle entre chaque tâche (ms, défaut 100)
   *   - configOverrides: options avancées (optionnel)
   *   - retriesLeft, priority, runAt, webhookUrl (optionnel)
   */
  public async scheduleManyCosmosQueries(opts: {
    count: number;
    address: string;
    queryType: string;
    intervalMs?: number;
    configOverrides?: Record<string, any>;
    retriesLeft?: number;
    priority?: number;
    runAt?: Date | string;
    webhookUrl?: string;
  }) {
    const {
      count,
      address,
      queryType,
      intervalMs = 100,
      configOverrides = {},
      retriesLeft = 0,
      priority = 0,
      runAt,
      webhookUrl
    } = opts;
    for (let i = 0; i < count; i++) {
      const scheduledAt = runAt
        ? (runAt instanceof Date ? new Date(runAt.getTime() + i * intervalMs) : new Date(new Date(runAt).getTime() + i * intervalMs))
        : new Date(Date.now() + i * intervalMs);
      this.schedule(async () => {}, {
        type: 'cosmos',
        runAt: scheduledAt,
        priority,
        retriesLeft,
        webhookUrl,
        config: {
          queryType,
          queryParams: { address },
          ...configOverrides
        }
      });
    }
  }

  /**
   * Schedule a new task and store its function in the taskMap.
   * @param taskFn The function to execute for this task
   * @param opts Task options: runAt, interval, priority, retriesLeft, type, config, webhookUrl
   * @returns The inserted task ID
   */
  public schedule(
    taskFn: () => Promise<void>,
    opts: {
      runAt: Date | string;
      interval?: number;
      priority?: number;
      retriesLeft?: number;
      type: string;
      config?: any;
      webhookUrl?: string;
    }
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (runAt, interval, priority, retriesLeft, type, config, webhookUrl)
      VALUES (@runAt, @interval, @priority, @retriesLeft, @type, @config, @webhookUrl)
    `);
    const info = stmt.run({
      runAt: opts.runAt instanceof Date ? opts.runAt.toISOString() : opts.runAt,
      interval: opts.interval ?? null,
      priority: opts.priority ?? 0,
      retriesLeft: opts.retriesLeft ?? 0,
      type: opts.type,
      config: opts.config ? JSON.stringify(opts.config) : null,
      webhookUrl: opts.webhookUrl ?? null
    });
    const taskId = Number(info.lastInsertRowid);
    return taskId;
  }
}

// Initialize Fastify server
const app: FastifyInstance = Fastify({
  logger: true
});

// Register form body parser for x-www-form-urlencoded (before declaring routes)
// eslint-disable-next-line @typescript-eslint/no-var-requires
app.register(require('@fastify/formbody'));

// Initialize SQLite database
const db = new Database('blazerjob.db');

const jobs = new BlazeJob({ dbPath: 'blazerjob.db' });

// GET /tasks: return all scheduled tasks
app.get('/tasks', async (request: FastifyRequest, reply: FastifyReply) => {
  const tasks = db.prepare('SELECT * FROM tasks').all();
  reply.send(tasks);
});

// POST /task: schedule a new task
app.post('/task', async (request: FastifyRequest, reply: FastifyReply) => {
  const { runAt, interval, priority, retriesLeft, type, config, webhookUrl } = (request.body as any) ?? {};
  // Simple example: handler by type
  let taskFn: () => Promise<void>;
  if (type === 'shell' && config?.cmd) {
    // Exécute une commande shell (sécurisé pour la démo, mais à restreindre en production)
    const { exec } = await import('child_process');
    taskFn = () => new Promise((resolve, reject) => {
      exec(config.cmd, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve();
      });
    });
  } else if (type === 'onchain' && config) {
    const cfg = JSON.parse(config) as OnchainTaskConfig;
    const rpcUrl = cfg.rpcUrl || process.env.RPC_URL;
    const privateKey = cfg.privateKey || process.env.PRIVATE_KEY;
    if (!rpcUrl) {
      throw new Error('No rpcUrl provided for onchain task (set in config or .env)');
    }
    if (!privateKey) {
      throw new Error('No privateKey provided for onchain task (set in config or .env)');
    }
    taskFn = async () => {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const wallet = new ethers.Wallet(privateKey, provider);
      const tx = await wallet.sendTransaction({
        to: cfg.to,
        value: ethers.parseEther(cfg.value),
        data: cfg.data ?? undefined,
        gasLimit: cfg.gasLimit ?? undefined
      });
      await tx.wait();
    };
  } else if (type === 'http' && config) {
    const cfg = JSON.parse(config) as HttpTaskConfig;
    taskFn = async () => {
      await fetch(cfg.url, {
        method: cfg.method ?? 'POST',
        headers: cfg.headers,
        body: cfg.body ? JSON.stringify(cfg.body) : undefined
      });
    };
  } else if (type === 'fintech' && config) {
    const cfg = JSON.parse(config) as FintechTaskConfig;
    taskFn = async () => {
      console.log('Fintech task:', cfg);
      // TODO: call external fintech API here
    };
  } else if (type === 'solana' && config) {
    const cfg = JSON.parse(config);
    const rpcUrl = cfg.rpcUrl || process.env.SOLANA_RPC_URL;
    const secretKey = cfg.secretKey || process.env.SOLANA_SECRET_KEY;
    if (!rpcUrl) throw new Error('No Solana rpcUrl (set in config or .env)');
    if (!secretKey) throw new Error('No Solana secretKey (set in config or .env)');
    taskFn = async () => {
      const connection = new Connection(rpcUrl, 'confirmed');
      const payer = Keypair.fromSecretKey(bs58.decode(secretKey));
      const toPubkey = new PublicKey(cfg.to);
      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey,
        lamports: cfg.lamports
      }));
      if (cfg.memo) {
        // Optionally add memo
      }
      await sendAndConfirmTransaction(connection, tx, [payer]);
    };
  } else if (type === 'email' && config) {
    const cfg = JSON.parse(config);
    const smtpHost = cfg.smtpHost || process.env.SMTP_HOST;
    const smtpPort = cfg.smtpPort || process.env.SMTP_PORT;
    const smtpUser = cfg.smtpUser || process.env.SMTP_USER;
    const smtpPass = cfg.smtpPass || process.env.SMTP_PASS;
    const from = cfg.from || process.env.EMAIL_FROM;
    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !from) {
      throw new Error('Missing SMTP config for email task');
    }
    taskFn = async () => {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(smtpPort),
        secure: false,
        auth: { user: smtpUser, pass: smtpPass }
      });
      await transporter.sendMail({
        from,
        to: cfg.to,
        subject: cfg.subject,
        text: cfg.text,
        html: cfg.html
      });
    };
  } else if (type === 'cosmos' && config) {
    const cfg = JSON.parse(config);
    const rpcUrl = cfg.rpcUrl || process.env.COSMOS_RPC_URL;
    const mnemonic = cfg.mnemonic || process.env.COSMOS_MNEMONIC;
    if (!rpcUrl) throw new Error('No Cosmos rpcUrl (set in config or .env)');
    if (cfg.to && cfg.amount && cfg.denom && mnemonic && cfg.chainId) {
      taskFn = async () => {
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: 'cosmos' });
        const [account] = await wallet.getAccounts();
        const client = await SigningStargateClient.connectWithSigner(rpcUrl, wallet);
        const fee = {
          amount: coins(cfg.gas || '5000', cfg.denom),
          gas: cfg.gas || '200000',
        };
        const result = await client.sendTokens(account.address, cfg.to, coins(cfg.amount, cfg.denom), fee, cfg.memo || '');
        if (result.code !== 0) throw new Error(result.rawLog);
        return;
      };
    } else if (cfg.queryType) {
      taskFn = async () => {
        const client = await StargateClient.connect(rpcUrl);
        let _res;
        if (cfg.queryType === 'balance') {
          _res = await client.getAllBalances(cfg.queryParams?.address);
          console.log('[Cosmos][balance]', cfg.queryParams?.address, _res);
        } else if (cfg.queryType === 'tx') {
          _res = await client.getTx(cfg.queryParams?.hash);
          console.log('[Cosmos][tx]', cfg.queryParams?.hash, _res);
        } else {
          throw new Error('Unknown Cosmos queryType');
        }
        console.log('[Cosmos][query result]', _res); // Ajout d'un console.log explicite
        return;
      };
    } else {
      throw new Error('Invalid Cosmos config: must provide tx params or queryType');
    }
  } else {
    // Par défaut, tâche factice
    taskFn = async () => {
      console.log('Task executed:', { type, config });
    };
  }
  const taskId = jobs.schedule(taskFn, { runAt, interval, priority, retriesLeft, type, config, webhookUrl });
  reply.code(201).send({ id: taskId });
});

// DELETE /task/:id: delete a task by id
app.delete('/task/:id', async (request: FastifyRequest, reply: FastifyReply) => {
  const { id } = request.params as { id: string };
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  reply.code(204).send();
});

// Méthode utilitaire pour arrêter proprement le serveur et le scheduler
export async function stopServer() {
  await app.close();
  jobs.stop();
  jobs['db'].close();
  console.log('Serveur et scheduler arrêtés proprement.');
}

// Optionnel : gestion du signal SIGTERM/SIGINT
process.on('SIGTERM', async () => {
  await stopServer();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await stopServer();
  process.exit(0);
});

if (require.main === module) {
  (async () => {
    await jobs.start();
    await app.listen({ port: 9000 });
    console.log('Fastify server running on http://localhost:9000');
  })();
}
