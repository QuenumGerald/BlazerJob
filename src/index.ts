import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Database from 'better-sqlite3';

export class BlazeJob {
  private db: Database.Database;
  private taskMap = new Map<number, () => Promise<void>>();
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
        status TEXT NOT NULL DEFAULT 'pending',
        executed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
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
      status: string;
      executed_at: string | null;
      created_at: string;
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
      const taskFn = this.taskMap.get(task.id);
      if (!taskFn) {
        // No function mapped, mark as failed
        this.db.prepare(`UPDATE tasks SET status = 'failed' WHERE id = ?`).run(task.id);
        continue;
      }
      try {
        await taskFn();
        if (task.interval && task.interval > 0) {
          // Reschedule for next interval
          const nextRun = new Date(Date.now() + task.interval).toISOString();
          this.db.prepare(`UPDATE tasks SET status = 'pending', runAt = ?, executed_at = ?, retriesLeft = ? WHERE id = ?`)
            .run(nextRun, now, task.retriesLeft, task.id);
        } else {
          // Mark as done
          this.db.prepare(`UPDATE tasks SET status = 'done', executed_at = ? WHERE id = ?`).run(now, task.id);
        }
      } catch (err) {
        const retriesLeft = (typeof task.retriesLeft === 'number' ? task.retriesLeft : 0) - 1;
        if (retriesLeft > 0) {
          // Retry later: status pending, runAt = now + 1min
          const retryRunAt = new Date(Date.now() + 60000).toISOString();
          this.db.prepare(`UPDATE tasks SET status = 'pending', runAt = ?, retriesLeft = ? WHERE id = ?`)
            .run(retryRunAt, retriesLeft, task.id);
        } else {
          // Mark as failed
          this.db.prepare(`UPDATE tasks SET status = 'failed' WHERE id = ?`).run(task.id);
        }
      }
    }
  }

  /**
   * Schedule a new task and store its function in the taskMap.
   * @param taskFn The function to execute for this task
   * @param opts Task options: runAt, interval, priority, retriesLeft, type, config
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
    }
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (runAt, interval, priority, retriesLeft, type, config)
      VALUES (@runAt, @interval, @priority, @retriesLeft, @type, @config)
    `);
    const info = stmt.run({
      runAt: opts.runAt instanceof Date ? opts.runAt.toISOString() : opts.runAt,
      interval: opts.interval ?? null,
      priority: opts.priority ?? 0,
      retriesLeft: opts.retriesLeft ?? 0,
      type: opts.type,
      config: opts.config ? JSON.stringify(opts.config) : null
    });
    const taskId = Number(info.lastInsertRowid);
    this.taskMap.set(taskId, taskFn);
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
  const { runAt, interval, priority, retriesLeft, type, config } = (request.body as any) ?? {};
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
  const taskId = jobs.schedule(taskFn, { runAt, interval, priority, retriesLeft, type, config });
  reply.code(201).send({ id: taskId });
});

// DELETE /task/:id: delete a task by id
app.delete('/task/:id', async (request: FastifyRequest, reply: FastifyReply) => {
  const { id } = request.params as { id: string };
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  jobs['taskMap'].delete(Number(id));
  reply.code(204).send();
});

(async () => {
  await jobs.start();
  await app.listen({ port: 9000 });
  console.log('Fastify server running on http://localhost:9000');
})();
