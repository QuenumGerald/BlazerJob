import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Database from 'better-sqlite3';
import fetch from 'node-fetch'; // si node <18

export class BlazeJob {
  private db: Database.Database;
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
      // Mark as running
      this.db.prepare(`UPDATE tasks SET status = 'running' WHERE id = ?`).run(task.id);
      // Reconstruire dynamiquement la fonction à exécuter
      let taskFn: () => Promise<void>;
      try {
        if (task.type === 'shell' && task.config) {
          const { cmd } = JSON.parse(task.config);
          const { exec } = await import('child_process');
          taskFn = () => new Promise((resolve, reject) => {
            exec(cmd, (error, stdout, stderr) => {
              if (error) reject(error);
              else resolve();
            });
          });
        } else {
          // Pour d'autres types, à compléter ici
          throw new Error('No handler for type');
        }
      } catch (err) {
        // Handler inconnu ou config invalide
        this.db.prepare(`UPDATE tasks SET status = 'failed', lastError = ? WHERE id = ?`).run(String(err), task.id);
        if (task.webhookUrl) {
          await BlazeJob.sendWebhook(task.webhookUrl, {
            taskId: task.id,
            status: 'failed',
            executedAt: new Date().toISOString(),
            result: 'error',
            output: undefined,
            error: String(err)
          });
        }
        continue;
      }
      // Execute task function
      try {
        await taskFn();
        this.db.prepare(`UPDATE tasks SET status = 'done', executed_at = ? WHERE id = ?`).run(new Date().toISOString(), task.id);
        if (task.webhookUrl) {
          await BlazeJob.sendWebhook(task.webhookUrl, {
            taskId: task.id,
            status: 'done',
            executedAt: new Date().toISOString(),
            result: 'success',
            output: undefined,
            error: null
          });
        }
        // Si interval, replanifier
        if (typeof task.interval === 'number' && task.interval > 0) {
          const nextRun = new Date(Date.now() + task.interval).toISOString();
          this.db.prepare(`UPDATE tasks SET status = 'pending', runAt = ?, executed_at = NULL WHERE id = ?`).run(nextRun, task.id);
        }
      } catch (err) {
        const retriesLeft = (typeof task.retriesLeft === 'number' ? task.retriesLeft : 0) - 1;
        if (retriesLeft > 0) {
          const retryRunAt = new Date(Date.now() + 60000).toISOString();
          this.db.prepare(`UPDATE tasks SET status = 'pending', runAt = ?, retriesLeft = ?, lastError = ? WHERE id = ?`).run(retryRunAt, retriesLeft, String(err), task.id);
          if (task.webhookUrl) {
            await BlazeJob.sendWebhook(task.webhookUrl, {
              taskId: task.id,
              status: 'pending',
              executedAt: new Date().toISOString(),
              result: 'retry',
              output: undefined,
              error: String(err)
            });
          }
        } else {
          this.db.prepare(`UPDATE tasks SET status = 'failed', lastError = ? WHERE id = ?`).run(String(err), task.id);
          if (task.webhookUrl) {
            await BlazeJob.sendWebhook(task.webhookUrl, {
              taskId: task.id,
              status: 'failed',
              executedAt: new Date().toISOString(),
              result: 'error',
              output: undefined,
              error: String(err)
            });
          }
        }
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
