"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlazeJob = void 0;
const fastify_1 = __importDefault(require("fastify"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
class BlazeJob {
    constructor(options) {
        this.taskMap = new Map();
        this.db = new better_sqlite3_1.default(options.dbPath);
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
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.timer) {
                this.timer = setInterval(() => this.tick(), 500);
            }
        });
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
    tick() {
        return __awaiter(this, void 0, void 0, function* () {
            const now = new Date().toISOString();
            const selectStmt = this.db.prepare(`
      SELECT * FROM tasks
      WHERE runAt <= @now AND status = 'pending'
      ORDER BY priority DESC, runAt ASC
    `);
            const dueTasks = selectStmt.all({ now });
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
                    yield taskFn();
                    if (task.interval && task.interval > 0) {
                        // Reschedule for next interval
                        const nextRun = new Date(Date.now() + task.interval).toISOString();
                        this.db.prepare(`UPDATE tasks SET status = 'pending', runAt = ?, executed_at = ?, retriesLeft = ? WHERE id = ?`)
                            .run(nextRun, now, task.retriesLeft, task.id);
                    }
                    else {
                        // Mark as done
                        this.db.prepare(`UPDATE tasks SET status = 'done', executed_at = ? WHERE id = ?`).run(now, task.id);
                    }
                }
                catch (err) {
                    const retriesLeft = (typeof task.retriesLeft === 'number' ? task.retriesLeft : 0) - 1;
                    if (retriesLeft > 0) {
                        // Retry later: status pending, runAt = now + 1min
                        const retryRunAt = new Date(Date.now() + 60000).toISOString();
                        this.db.prepare(`UPDATE tasks SET status = 'pending', runAt = ?, retriesLeft = ? WHERE id = ?`)
                            .run(retryRunAt, retriesLeft, task.id);
                    }
                    else {
                        // Mark as failed
                        this.db.prepare(`UPDATE tasks SET status = 'failed' WHERE id = ?`).run(task.id);
                    }
                }
            }
        });
    }
    /**
     * Schedule a new task and store its function in the taskMap.
     * @param taskFn The function to execute for this task
     * @param opts Task options: runAt, interval, priority, retriesLeft, type, config
     * @returns The inserted task ID
     */
    schedule(taskFn, opts) {
        var _a, _b, _c;
        const stmt = this.db.prepare(`
      INSERT INTO tasks (runAt, interval, priority, retriesLeft, type, config)
      VALUES (@runAt, @interval, @priority, @retriesLeft, @type, @config)
    `);
        const info = stmt.run({
            runAt: opts.runAt instanceof Date ? opts.runAt.toISOString() : opts.runAt,
            interval: (_a = opts.interval) !== null && _a !== void 0 ? _a : null,
            priority: (_b = opts.priority) !== null && _b !== void 0 ? _b : 0,
            retriesLeft: (_c = opts.retriesLeft) !== null && _c !== void 0 ? _c : 0,
            type: opts.type,
            config: opts.config ? JSON.stringify(opts.config) : null
        });
        const taskId = Number(info.lastInsertRowid);
        this.taskMap.set(taskId, taskFn);
        return taskId;
    }
}
exports.BlazeJob = BlazeJob;
// Initialize Fastify server
const app = (0, fastify_1.default)({
    logger: true
});
// Register form body parser for x-www-form-urlencoded (before declaring routes)
// eslint-disable-next-line @typescript-eslint/no-var-requires
app.register(require('@fastify/formbody'));
// Initialize SQLite database
const db = new better_sqlite3_1.default('blazerjob.db');
const jobs = new BlazeJob({ dbPath: 'blazerjob.db' });
// GET /tasks: return all scheduled tasks
app.get('/tasks', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    const tasks = db.prepare('SELECT * FROM tasks').all();
    reply.send(tasks);
}));
// POST /task: schedule a new task
app.post('/task', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const { runAt, interval, priority, retriesLeft, type, config } = (_a = request.body) !== null && _a !== void 0 ? _a : {};
    // Simple example: handler by type
    let taskFn;
    if (type === 'shell' && (config === null || config === void 0 ? void 0 : config.cmd)) {
        // Exécute une commande shell (sécurisé pour la démo, mais à restreindre en production)
        const { exec } = yield Promise.resolve().then(() => __importStar(require('child_process')));
        taskFn = () => new Promise((resolve, reject) => {
            exec(config.cmd, (error, stdout, stderr) => {
                if (error)
                    reject(error);
                else
                    resolve();
            });
        });
    }
    else {
        // Par défaut, tâche factice
        taskFn = () => __awaiter(void 0, void 0, void 0, function* () {
            console.log('Task executed:', { type, config });
        });
    }
    const taskId = jobs.schedule(taskFn, { runAt, interval, priority, retriesLeft, type, config });
    reply.code(201).send({ id: taskId });
}));
// DELETE /task/:id: delete a task by id
app.delete('/task/:id', (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = request.params;
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    jobs['taskMap'].delete(Number(id));
    reply.code(204).send();
}));
(() => __awaiter(void 0, void 0, void 0, function* () {
    yield jobs.start();
    yield app.listen({ port: 9000 });
    console.log('Fastify server running on http://localhost:9000');
}))();
