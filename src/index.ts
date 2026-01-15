import * as dotenv from 'dotenv';
dotenv.config();

import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
// @ts-ignore
const Database = require('better-sqlite3');
import fetch from 'node-fetch'; // si node <18
import { TaskType, TaskConfig, CosmosTaskConfig, HttpTaskConfig } from './types';
import { SigningStargateClient, StargateClient, coins } from '@cosmjs/stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { makeCosmosTaskFn } from './cosmos/queries';
import { makeHttpTaskFn } from './http/queries';

export interface ScheduleExtra {
  maxRuns?: number;
  maxDurationMs?: number;
  onEnd?: (stats: { runCount: number, errorCount: number }) => void;
}

export type OnTaskEnd = (taskId: number, stats: { runCount: number, errorCount: number }) => void;

export type OnAllTasksEnded = () => void;

export interface BlazeJobOptions {
  dbPath: string;
  autoExit?: boolean;
  concurrency?: number;
}

export class BlazeJob {
  private db: any;
  private timer?: NodeJS.Timeout;
  // Map: taskId -> { runCount, startedAt, maxRuns, maxDurationMs }
  private taskRunStats = new Map<number, { runCount: number, startedAt: number, maxRuns?: number, maxDurationMs?: number, onEnd?: (stats: { runCount: number, errorCount: number }) => void, errorCount?: number }>();
  private taskErrorCount = new Map<number, number>();
  private periodicTaskCount = 0;
  private onAllTasksEndedCb?: OnAllTasksEnded;
  private autoExit: boolean;
  private concurrency: number;
  private activeTasksCount = 0;
  // Map: taskId -> taskFn (en mémoire)
  private taskFns = new Map<number, () => Promise<void>>();

  public onAllTasksEnded(cb: OnAllTasksEnded) {
    this.onAllTasksEndedCb = cb;
  }

  constructor(options: BlazeJobOptions) {
    this.db = new Database(options.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.autoExit = !!options.autoExit;
    this.concurrency = options.concurrency || 1;
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        runAt TEXT,
        interval INTEGER,
        priority INTEGER,
        retriesLeft INTEGER,
        type TEXT,
        config TEXT,
        webhookUrl TEXT,
        status TEXT DEFAULT 'pending',
        executed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
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
      this.timer = setInterval(() => this.tick(), 50);
    }
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick() {
    // console.log('[BlazeJob][DEBUG] tick() called. periodicTaskCount:', this.periodicTaskCount, 'taskRunStats:', Array.from(this.taskRunStats.keys()));
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
    const availableSlots = this.concurrency - this.activeTasksCount;
    if (availableSlots <= 0) return;
    const selectStmt = this.db.prepare(`
      SELECT * FROM tasks
      WHERE runAt <= @now AND status = 'pending'
      ORDER BY priority DESC, runAt ASC
      LIMIT ${availableSlots}
    `);
    const dueTasks = selectStmt.all({ now }) as TaskRow[];
    if (dueTasks.length === 0) return;

    for (const task of dueTasks) {
      this.db.prepare(`UPDATE tasks SET status = 'running' WHERE id = ?`).run(task.id);
      this.activeTasksCount++;
      (async () => {
        const stat = this.taskRunStats.get(task.id);
        try {
          let taskFn: () => Promise<void> = async () => { };
          // Si la tâche a une fonction JS custom (stockée en mémoire), on l'utilise
          if (this.taskFns.has(task.id)) {
            taskFn = this.taskFns.get(task.id)!;
          } else if (task.type === 'cosmos') {
            const config = typeof task.config === 'string' ? JSON.parse(task.config) : task.config;
            let configCopy = JSON.parse(JSON.stringify(config)); // clonage profond
            if (typeof configCopy === 'string') {
              configCopy = JSON.parse(configCopy);
            }
            taskFn = makeCosmosTaskFn(configCopy);
          } else if (task.type === 'http' && task.config) {
            let config: any = task.config;
            // Correction : parser plusieurs fois si besoin
            for (let i = 0; i < 2; i++) {
              if (typeof config === 'string') {
                try {
                  config = JSON.parse(config);
                } catch (e) {
                  console.error('[BlazeJob][HTTP] Erreur de parsing config:', e, config);
                  break;
                }
              }
            }
            taskFn = makeHttpTaskFn(config);
          } else {
            // NE PAS réassigner taskFn ici pour laisser la fonction custom s'exécuter
          }
          await taskFn();
          // Après exécution de la tâche (succès ou erreur)
          if (stat) {
            stat.runCount++;
            // Vérifie si on a atteint maxRuns ou maxDuration
            if ((stat.maxRuns && stat.runCount >= stat.maxRuns) || (stat.maxDurationMs && Date.now() - stat.startedAt > stat.maxDurationMs)) {
              let shouldTerminate = true;
            }
          }
          if (typeof task.interval === 'number' && task.interval > 0 && (!stat?.maxRuns || stat.runCount < stat.maxRuns)) {
            // Replanifier la tâche périodique
            const nextRunAt = new Date(Date.now() + task.interval).toISOString();
            this.db.prepare(`UPDATE tasks SET status = 'pending', runAt = ? WHERE id = ?`).run(nextRunAt, task.id);
          } else {
            // Tâche terminée (succès ou fin de retry)
            this.db.prepare(`UPDATE tasks SET status = 'success', executed_at = ? WHERE id = ?`).run(new Date().toISOString(), task.id);
            if (stat && stat.onEnd) stat.onEnd({ runCount: stat.runCount, errorCount: stat.errorCount || 0 });
            this.taskRunStats.delete(task.id);
            this.periodicTaskCount--;
            // console.log('[BlazeJob][DEBUG] Après suppression, periodicTaskCount:', this.periodicTaskCount, 'taskRunStats:', Array.from(this.taskRunStats.keys()));
            if (this.periodicTaskCount === 0 && this.onAllTasksEndedCb) this.onAllTasksEndedCb();
            if (this.periodicTaskCount === 0 && this.autoExit) {
              // console.log('[BlazeJob][DEBUG] Condition autoExit atteinte, arrêt dans 200ms');
              setTimeout(() => {
                try {
                  this.stop();
                } catch (e) {
                  console.error('[BlazeJob] Erreur lors de l\'arrêt du scheduler', e);
                }
                try {
                  if (this.db && typeof this.db.close === 'function') this.db.close();
                } catch (e) {
                  console.error('[BlazeJob] Erreur lors de la fermeture de la base', e);
                }
                console.log('[BlazeJob] Toutes les tâches périodiques sont terminées. Arrêt automatique du process.');
                process.exit(0);
              }, 200);
            }
          }
        } catch (err) {
          console.error('[BlazeJob] Erreur lors de l\'exécution de la tâche', task.id, err);

          // Mettre à jour le compteur d'erreurs
          if (stat) {
            stat.errorCount = (stat.errorCount || 0) + 1;
          }

          // Sauvegarder l'erreur dans la base
          const errorMessage = err instanceof Error ? err.message : String(err);
          this.db.prepare(`UPDATE tasks SET lastError = ? WHERE id = ?`).run(errorMessage, task.id);

          // Décrémenter retriesLeft
          const newRetriesLeft = Math.max(0, task.retriesLeft - 1);

          if (newRetriesLeft > 0) {
            // Calculer le backoff exponentiel : 1s, 2s, 4s, 8s, 16s...
            const attemptNumber = (stat?.errorCount || 1);
            const backoffMs = 1000 * Math.pow(2, attemptNumber - 1);
            const nextRunAt = new Date(Date.now() + backoffMs).toISOString();

            console.log(`[BlazeJob] Tâche ${task.id} échouée (tentative ${attemptNumber}). Retry dans ${backoffMs}ms (retriesLeft: ${newRetriesLeft})`);

            // Replanifier la tâche avec backoff exponentiel
            this.db.prepare(`
              UPDATE tasks
              SET status = 'pending', runAt = ?, retriesLeft = ?
              WHERE id = ?
            `).run(nextRunAt, newRetriesLeft, task.id);
          } else {
            // Plus de retries disponibles, marquer comme échouée
            console.log(`[BlazeJob] Tâche ${task.id} définitivement échouée après ${stat?.errorCount || 1} tentative(s)`);

            this.db.prepare(`
              UPDATE tasks
              SET status = 'failed', executed_at = ?, retriesLeft = 0
              WHERE id = ?
            `).run(new Date().toISOString(), task.id);

            // Appeler le callback onEnd si présent
            if (stat && stat.onEnd) {
              stat.onEnd({ runCount: stat.runCount, errorCount: stat.errorCount || 0 });
            }

            // Nettoyer les stats et décrémenter le compteur de tâches périodiques
            this.taskRunStats.delete(task.id);
            this.periodicTaskCount--;

            // Vérifier si toutes les tâches sont terminées
            if (this.periodicTaskCount === 0 && this.onAllTasksEndedCb) {
              this.onAllTasksEndedCb();
            }

            if (this.periodicTaskCount === 0 && this.autoExit) {
              setTimeout(() => {
                try {
                  this.stop();
                } catch (e) {
                  console.error('[BlazeJob] Erreur lors de l\'arrêt du scheduler', e);
                }
                try {
                  if (this.db && typeof this.db.close === 'function') this.db.close();
                } catch (e) {
                  console.error('[BlazeJob] Erreur lors de la fermeture de la base', e);
                }
                console.log('[BlazeJob] Toutes les tâches périodiques sont terminées. Arrêt automatique du process.');
                process.exit(0);
              }, 200);
            }
          }
        } finally {
          this.activeTasksCount--;
        }
      })();
    }

    // Drain immédiatement si d'autres tâches sont prêtes et qu'il reste de la capacité,
    // sans attendre le prochain intervalle.
    if (dueTasks.length === availableSlots) {
      setImmediate(() => this.tick());
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
      this.schedule(async () => { }, {
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
    options: any & ScheduleExtra
  ): number {
    const {
      runAt,
      interval,
      priority,
      retriesLeft,
      type,
      config,
      webhookUrl,
      maxRuns,
      maxDurationMs,
      onEnd
    } = options;
    const stmt = this.db.prepare(`
      INSERT INTO tasks (runAt, interval, priority, retriesLeft, type, config, webhookUrl)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      runAt instanceof Date ? runAt.toISOString() : runAt,
      interval,
      priority,
      retriesLeft,
      type,
      config ? JSON.stringify(config) : null,
      webhookUrl
    );
    const taskId = result.lastInsertRowid as number;
    // Stocke la fonction JS en mémoire pour ce taskId
    this.taskFns.set(taskId, taskFn);
    this.taskRunStats.set(taskId, {
      runCount: 0,
      startedAt: Date.now(),
      maxRuns,
      maxDurationMs,
      onEnd,
      errorCount: 0
    });
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
  const { runAt, interval, priority, retriesLeft, type, config, webhookUrl, maxRuns, maxDurationMs, onEnd } = (request.body as any) ?? {};
  let taskFn: () => Promise<void> = async () => { };
  if (type === 'cosmos' && config) {
    const cfg = JSON.parse(config) as CosmosTaskConfig;
    const rpcUrl = cfg.rpcUrl || process.env.COSMOS_RPC_URL;
    const mnemonic = cfg.mnemonic || process.env.COSMOS_MNEMONIC;
    if (!rpcUrl) throw new Error('No Cosmos rpcUrl (set in config or .env)');
    if (cfg.to && cfg.amount && cfg.denom && mnemonic && cfg.chainId) {
      // Send tokens
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
      // Query
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
        console.log('[Cosmos][query result]', _res);
        return;
      };
    } else {
      throw new Error('Invalid Cosmos config: must provide tx params or queryType');
    }
  } else if (type === 'http' && config) {
    const cfg = JSON.parse(config) as HttpTaskConfig;
    taskFn = makeHttpTaskFn(cfg);
  } else {
    // Par défaut, tâche factice
    taskFn = async () => {
      console.log('Task executed:', { type, config });
    };
  }
  const taskId = jobs.schedule(taskFn, { runAt, interval, priority, retriesLeft, type, config, webhookUrl, maxRuns, maxDurationMs, onEnd });
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
