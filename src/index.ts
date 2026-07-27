import Database from 'better-sqlite3';
import fetch from 'node-fetch'; // si node <18
import * as crypto from 'crypto';
import { makeHttpTaskFn } from './http/queries';

export interface ScheduleExtra {
  maxRuns?: number;
  maxDurationMs?: number;
  onEnd?: (stats: { runCount: number, errorCount: number }) => void;
}

export type OnTaskEnd = (taskId: number, stats: { runCount: number, errorCount: number }) => void;

export type OnAllTasksEnded = () => void;

export interface BlazeJobOptions {
  dbPath?: string;
  storage?: 'sqlite' | 'memory';
  autoExit?: boolean;
  concurrency?: number;
  encryptionKey?: string;
  debug?: boolean;
}

const ALGORITHM = 'aes-256-gcm';
function getEncryptionKey(optionsKey?: string): Buffer {
  const key = optionsKey || process.env.BLAZERJOB_ENCRYPTION_KEY || 'default_blazerjob_secret_do_not_use_in_prod';
  return crypto.scryptSync(key, 'salt', 32);
}

function encryptConfig(configStr: string | null, key: Buffer): string | null {
  if (!configStr) return configStr;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(configStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `enc:v1:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptConfig(encryptedStr: string | null, key: Buffer): string | null {
  if (!encryptedStr || !encryptedStr.startsWith('enc:v1:')) {
    return encryptedStr;
  }
  const parts = encryptedStr.split(':');
  if (parts.length !== 5) return encryptedStr;
  const iv = Buffer.from(parts[2], 'hex');
  const authTag = Buffer.from(parts[3], 'hex');
  const encryptedText = parts[4];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export class BlazeJob {
  private db?: Database.Database;
  private readonly dbPath: string;
  private readonly useMemoryStorage: boolean;
  private timer?: NodeJS.Timeout;
  private encryptionKey: Buffer;
  // Map: taskId -> { runCount, startedAt, maxRuns, maxDurationMs }
  private taskRunStats = new Map<number, { runCount: number, startedAt: number, maxRuns?: number, maxDurationMs?: number, onEnd?: (stats: { runCount: number, errorCount: number }) => void, errorCount?: number }>();
  private taskErrorCount = new Map<number, number>();
  private taskCount = 0;
  private onAllTasksEndedCb?: OnAllTasksEnded;
  private autoExit: boolean;
  private concurrency: number;
  private debug: boolean;
  private activeTasksCount = 0;
  // Map: taskId -> taskFn (en mémoire)
  private taskFns = new Map<number, () => Promise<void>>();

  public onAllTasksEnded(cb: OnAllTasksEnded) {
    this.onAllTasksEndedCb = cb;
  }

  constructor(options: BlazeJobOptions) {
    this.encryptionKey = getEncryptionKey(options.encryptionKey);
    this.useMemoryStorage = options.storage !== 'sqlite';
    this.dbPath = this.useMemoryStorage ? ':memory:' : (options.dbPath || 'blazerjob.db');
    this.autoExit = !!options.autoExit;
    this.concurrency = options.concurrency || 1;
    this.debug = !!options.debug;
  }

  private initializeDatabase(): void {
    const db = this.getDatabase();
    if (!this.useMemoryStorage) {
      db.pragma('journal_mode = WAL');
    }
    db.prepare(`
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
      db.prepare('ALTER TABLE tasks ADD COLUMN lastError TEXT').run();
    } catch (e) {
      // Ignore si déjà présent
    }
    try {
      db.prepare('ALTER TABLE tasks ADD COLUMN webhookUrl TEXT').run();
    } catch (e) {
      // Ignore si déjà présent
    }
  }

  private getDatabase(): Database.Database {
    if (!this.db) {
      throw new Error('BlazeJob is not started. Call and await start() before using the scheduler.');
    }
    return this.db;
  }

  public async start(): Promise<void> {
    if (!this.db) {
      const db = new Database(this.dbPath);
      this.db = db;
      try {
        this.initializeDatabase();
      } catch (error) {
        db.close();
        this.db = undefined;
        throw error;
      }
    }
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), 50);
    }
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.db) {
      this.db.close();
      this.db = undefined;
    }
  }

  public close(): void {
    this.stop();
  }

  private async tick() {
    const db = this.getDatabase();
    if (this.debug) {
      console.log('[BlazeJob][DEBUG] tick() called. taskCount:', this.taskCount, 'taskRunStats:', Array.from(this.taskRunStats.keys()));
      console.log('[BlazeJob] tick');
    }
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
    const selectStmt = db.prepare(`
      SELECT * FROM tasks
      WHERE runAt <= @now AND status = 'pending'
      ORDER BY priority DESC, runAt ASC
      LIMIT ${availableSlots}
    `);
    const dueTasks = selectStmt.all({ now }) as TaskRow[];
    if (dueTasks.length === 0) return;

    for (const task of dueTasks) {
      db.prepare(`UPDATE tasks SET status = 'running' WHERE id = ?`).run(task.id);
      this.activeTasksCount++;
      (async () => {
        const stat = this.taskRunStats.get(task.id);
        try {
          let taskFn: () => Promise<void> = async () => { };
          // Decrypt config before execution if needed
          const decryptedConfig = decryptConfig(task.config, this.encryptionKey);
          // If the task has a custom JS function (stored in memory), use it
          if (this.taskFns.has(task.id)) {
            taskFn = this.taskFns.get(task.id)!;
          } else if (task.type === 'http' && decryptedConfig) {
            let config: any = decryptedConfig;
            // Parse multiple times if needed
            for (let i = 0; i < 2; i++) {
              if (typeof config === 'string') {
                try {
                  config = JSON.parse(config);
                } catch (e) {
                  console.error('[BlazeJob][HTTP] Config parsing error:', e, config);
                  break;
                }
              }
            }
            taskFn = makeHttpTaskFn(config);
          } else {
            // Do not reassign taskFn here to let custom function execute
          }
          await taskFn();
          // Après exécution de la tâche (succès ou erreur)
          if (stat) {
            stat.runCount++;
            // Vérifie si on a atteint maxRuns ou maxDuration
            if ((stat.maxRuns && stat.runCount >= stat.maxRuns) || (stat.maxDurationMs && Date.now() - stat.startedAt > stat.maxDurationMs)) {
              // On ne replanifiera pas (voir condition plus bas)
            }
          }
          const isOverMaxRuns = stat?.maxRuns && stat.runCount >= stat.maxRuns;
          const isOverMaxDuration = stat?.maxDurationMs && Date.now() - stat.startedAt > (stat.maxDurationMs || Infinity);

          if (typeof task.interval === 'number' && task.interval > 0 && !isOverMaxRuns && !isOverMaxDuration) {
            // Replanifier la tâche périodique
            const nextRunAt = new Date(Date.now() + task.interval).toISOString();
            db.prepare(`UPDATE tasks SET status = 'pending', runAt = ? WHERE id = ?`).run(nextRunAt, task.id);
          } else {
            // Tâche terminée (succès ou fin de retry)
            db.prepare(`UPDATE tasks SET status = 'success', executed_at = ? WHERE id = ?`).run(new Date().toISOString(), task.id);
            if (stat && stat.onEnd) stat.onEnd({ runCount: stat.runCount, errorCount: stat.errorCount || 0 });
            this.taskRunStats.delete(task.id);
            this.taskCount--;
            // console.log('[BlazeJob][DEBUG] Après suppression, taskCount:', this.taskCount, 'taskRunStats:', Array.from(this.taskRunStats.keys()));
            if (this.taskCount === 0 && this.onAllTasksEndedCb) this.onAllTasksEndedCb();
            if (this.taskCount === 0 && this.autoExit) {
              // console.log('[BlazeJob][DEBUG] Condition autoExit atteinte, arrêt dans 200ms');
              setTimeout(() => {
                try {
                  this.stop();
                } catch (e) {
                  console.error('[BlazeJob] Erreur lors de l\'arrêt du scheduler', e);
                }
                console.log('[BlazeJob] Toutes les tâches périodiques sont terminées. Arrêt automatique du process.');
                process.exit(0);
              }, 200);
            }
          }
        } catch (err) {
          console.error('[BlazeJob] Erreur lors de l\'exécution de la tâche', task.id, err);
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

  public getTasks(): any[] {
    const tasks = this.getDatabase().prepare('SELECT * FROM tasks').all();
    return tasks.map((task: any) => {
      if (task.config) {
        task.config = decryptConfig(task.config, this.encryptionKey);
      }
      return task;
    });
  }

  public deleteTask(taskId: number): void {
    this.getDatabase().prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    // Clean up memory maps
    this.taskFns.delete(taskId);
    this.taskRunStats.delete(taskId);
    this.taskErrorCount.delete(taskId);
  }

  /**
   * Schedule a new task and store its function in the taskMap.
   * @param taskFn The function to execute for this task
   * @param opts Task options: runAt, interval, priority, retriesLeft, type, config, webhookUrl
   * @returns The inserted task ID
   */
  public schedule(
    taskFn: (() => Promise<void>) | undefined,
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
    const stmt = this.getDatabase().prepare(`
      INSERT INTO tasks (runAt, interval, priority, retriesLeft, type, config, webhookUrl)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      runAt instanceof Date ? runAt.toISOString() : runAt,
      interval,
      priority,
      retriesLeft,
      type,
      config ? encryptConfig(JSON.stringify(config), this.encryptionKey) : null,
      webhookUrl
    );
    const taskId = result.lastInsertRowid as number;
    // Stocke la fonction JS en mémoire pour ce taskId (si fournie)
    if (taskFn) {
      this.taskFns.set(taskId, taskFn);
    }
    this.taskRunStats.set(taskId, {
      runCount: 0,
      startedAt: Date.now(),
      maxRuns,
      maxDurationMs,
      onEnd,
      errorCount: 0
    });
    this.taskCount++;
    return taskId;
  }
}
