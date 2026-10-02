import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { decryptConfig, deriveKey, encryptConfig, isEncrypted } from './crypto';
import {
  BlazeJobError,
  EncryptionKeyRequiredError,
  MissingHandlerError,
  NonResumableTaskError,
  TaskCancelledError,
  TaskTimeoutError
} from './errors';
import { executeHttpTask } from './http/queries';
import { computeBackoffMs, shouldRetry, toStructuredError } from './retry';
import { migrateSchema } from './schema';
import {
  AnonymousHandler,
  BlazeJobOptions,
  NamedHandler,
  OnAllTasksEnded,
  RateLimitOptions,
  RetryPolicyName,
  ScheduleExtra,
  StructuredError,
  TaskContext,
  TaskObserver,
  TaskSnapshot,
  TaskStatus
} from './types';

export type {
  AnonymousHandler,
  BlazeJobOptions,
  NamedHandler,
  OnAllTasksEnded,
  OnTaskEnd,
  RateLimitOptions,
  ResultRetentionOptions,
  RetryOptions,
  ScheduleExtra,
  StructuredError,
  TaskContext,
  TaskObserver,
  TaskSnapshot,
  TaskStatus
} from './types';

interface TaskRow {
  id: number;
  runAt: string;
  interval: number | null;
  priority: number | null;
  retriesLeft: number | null;
  type: string | null;
  config: string | null;
  webhookUrl: string | null;
  status: string;
  executed_at: string | null;
  created_at: string | null;
  lastError: string | null;
  handler_name: string | null;
  payload: string | null;
  result_json: string | null;
  error_json: string | null;
  attempt_count: number | null;
  max_attempts: number | null;
  timeout_ms: number | null;
  max_duration_ms: number | null;
  max_runs: number | null;
  run_count: number | null;
  error_count: number | null;
  started_at: string | null;
  lease_until: string | null;
  worker_id: string | null;
  backoff_until: string | null;
  resumable: number | null;
  retry_policy: string | null;
  backoff_ms: number | null;
  backoff_multiplier: number | null;
  jitter: number | null;
  result_stored_at: string | null;
}

interface MemoryState {
  fn?: AnonymousHandler;
  onEnd?: (stats: { runCount: number; errorCount: number }) => void;
  abort?: AbortController;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function jsonSafe(value: unknown, maxBytes: number): string | null {
  if (value === undefined) return null;
  const text = JSON.stringify(value);
  if (text === undefined) return null;
  const bytes = Buffer.byteLength(text);
  if (bytes > maxBytes) {
    return JSON.stringify({ truncated: true, bytes });
  }
  return text;
}

export class BlazeJob {
  private db: Database.Database;
  private timer?: NodeJS.Timeout;
  private encryptionKey: Buffer | null;
  private encryptConfigs: boolean;
  private autoExit: boolean;
  private concurrency: number;
  private debug: boolean;
  private activeTasksCount = 0;
  private shuttingDown = false;
  private closed = false;
  private persistResults: boolean;
  private maxResultBytes: number;
  private resultTtlMs: number | null;
  private leaseMs: number;
  private workerId: string;
  private nowFn: () => number;
  private rate?: RateLimitOptions;
  private startTimestamps: number[] = [];
  private memory = new Map<number, MemoryState>();
  private handlers = new Map<string, NamedHandler>();
  private observers = new Set<TaskObserver>();
  private waiters = new Map<number, Array<(snapshot: TaskSnapshot) => void>>();
  private onAllTasksEndedCb?: OnAllTasksEnded;
  private taskCount = 0;
  private tickScheduled = false;

  constructor(options: BlazeJobOptions = {}) {
    const envKey = process.env.BLAZERJOB_ENCRYPTION_KEY;
    const provided = options.encryptionKey ?? envKey;
    this.encryptConfigs = options.encryptConfigs === true;
    if (this.encryptConfigs && !provided) {
      throw new EncryptionKeyRequiredError(
        'encryptConfigs is true but no encryptionKey / BLAZERJOB_ENCRYPTION_KEY was provided. There is no implicit default key.'
      );
    }
    this.encryptionKey = provided ? deriveKey(provided) : null;
    const useMemoryStorage = options.storage !== 'sqlite';
    const dbPath = useMemoryStorage ? ':memory:' : (options.dbPath || 'blazerjob.db');
    this.db = new Database(dbPath);
    if (!useMemoryStorage) {
      this.db.pragma('journal_mode = WAL');
    }
    migrateSchema(this.db);
    this.autoExit = !!options.autoExit;
    this.concurrency = this.validateConcurrency(options.concurrency);
    this.debug = !!options.debug;
    this.persistResults = options.persistResults !== false;
    this.maxResultBytes = options.resultRetention?.maxBytes ?? 64 * 1024;
    this.resultTtlMs = options.resultRetention?.ttlMs ?? null;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.workerId = options.workerId ?? randomUUID();
    this.nowFn = options.now ?? (() => Date.now());
    if (options.rate) this.rate = this.validateRate(options.rate);
    this.taskCount = (this.db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE status IN ('pending','running','blocked')`).get() as { c: number }).c;
  }

  public registerHandler(name: string, handler: NamedHandler): void {
    if (!name || typeof handler !== 'function') {
      throw new BlazeJobError('registerHandler requires a name and a function', { code: 'HANDLER', permanent: true });
    }
    this.handlers.set(name, handler);
    const blocked = this.db.prepare(`SELECT id FROM tasks WHERE status = 'blocked' AND handler_name = ?`).all(name) as Array<{ id: number }>;
    this.db.prepare(
      `UPDATE tasks SET status = 'pending', lastError = NULL WHERE status = 'blocked' AND handler_name = ?`
    ).run(name);
    for (const row of blocked) {
      const snap = this.getTask(row.id);
      if (snap) this.notify(snap);
    }
    void this.tick();
  }

  public on(event: 'task', observer: TaskObserver): () => void {
    if (event !== 'task') throw new BlazeJobError(`Unsupported event ${event}`, { code: 'EVENT', permanent: true });
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  public onAllTasksEnded(cb: OnAllTasksEnded) {
    this.onAllTasksEndedCb = cb;
  }

  public async start() {
    if (this.closed) throw new BlazeJobError('Scheduler is closed', { code: 'CLOSED', permanent: true });
    this.shuttingDown = false;
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), 50);
    }
    void this.tick();
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  public async shutdown(options: { timeoutMs?: number } = {}): Promise<void> {
    this.shuttingDown = true;
    this.stop();
    const timeoutMs = options.timeoutMs ?? 10_000;
    const deadline = this.nowFn() + timeoutMs;
    while (this.activeTasksCount > 0 && this.nowFn() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    if (this.activeTasksCount > 0) {
      for (const state of this.memory.values()) {
        try { state.abort?.abort(); } catch { /* ignore */ }
      }
      const waitAbort = this.nowFn() + 200;
      while (this.activeTasksCount > 0 && this.nowFn() < waitAbort) {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    this.close();
  }

  public close() {
    this.stop();
    this.closed = true;
    if (this.db.open) this.db.close();
  }

  public getTask(id: number): TaskSnapshot | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? this.toSnapshot(row) : null;
  }

  public getTaskResult(id: number): TaskSnapshot | null {
    return this.getTask(id);
  }

  public waitFor(id: number, options: { timeoutMs?: number } = {}): Promise<TaskSnapshot> {
    const current = this.getTask(id);
    if (current && this.isTerminal(current.status) && current.status !== 'blocked') {
      return Promise.resolve(current);
    }
    return new Promise((resolve, reject) => {
      const timer = options.timeoutMs
        ? setTimeout(() => {
            this.removeWaiter(id, onSnap);
            reject(new TaskTimeoutError(options.timeoutMs!));
          }, options.timeoutMs)
        : undefined;
      const onSnap = (snapshot: TaskSnapshot) => {
        if (snapshot.status === 'blocked') return;
        if (this.isTerminal(snapshot.status)) {
          if (timer) clearTimeout(timer);
          this.removeWaiter(id, onSnap);
          resolve(snapshot);
        }
      };
      const list = this.waiters.get(id) ?? [];
      list.push(onSnap);
      this.waiters.set(id, list);
    });
  }

  public cancel(taskId: number): boolean {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
    if (!row) return false;
    if (this.isTerminal(row.status) && row.status !== 'running') return false;
    const mem = this.memory.get(taskId);
    mem?.abort?.abort();
    if (row.status === 'running') {
      // Signal is sent; finalizeCancelled happens when the worker observes abort or returns.
      this.db.prepare(`UPDATE tasks SET lastError = ? WHERE id = ?`).run('cancellation requested', taskId);
      return true;
    }
    this.finalize(taskId, 'cancelled', null, toStructuredError(new TaskCancelledError()), row);
    return true;
  }

  public deleteTask(taskId: number): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    this.cleanupMemory(taskId);
  }

  public getTasks(): any[] {
    const tasks = this.db.prepare('SELECT * FROM tasks').all() as TaskRow[];
    return tasks.map((task) => {
      const copy: any = { ...task };
      if (task.config) {
        copy.config = parseMaybeJson(decryptConfig(task.config, this.encryptionKey));
      }
      if (task.payload) copy.payload = parseMaybeJson(task.payload);
      if (task.result_json) copy.result = parseMaybeJson(task.result_json);
      if (task.error_json) copy.error = parseMaybeJson(task.error_json);
      return copy;
    });
  }

  public schedule(
    taskFn: AnonymousHandler | (() => Promise<unknown>) | undefined,
    options: Record<string, unknown> & ScheduleExtra = {}
  ): number {
    const type = String(options.type ?? (taskFn ? 'custom' : ''));
    if (type === 'http' && typeof taskFn === 'function') {
      throw new BlazeJobError(
        "Native HTTP tasks must be scheduled without a custom function. Use schedule(undefined, { type: 'http', config }) or scheduleHttp().",
        { code: 'CONFLICTING_HANDLER', permanent: true }
      );
    }
    if (type === 'http' && !options.config) {
      throw new BlazeJobError('HTTP tasks require a config object with url', { code: 'HTTP_CONFIG', permanent: true });
    }
    if (type !== 'http' && !taskFn && !options.handler) {
      throw new BlazeJobError(
        'Custom tasks require either an in-memory function (not resumable) or a registered handler name.',
        { code: 'MISSING_HANDLER', permanent: true }
      );
    }

    const retry = options.retry ?? {};
    const retriesLeft = options.retriesLeft as number | undefined;
    const maxAttempts = retry.maxAttempts ?? (typeof retriesLeft === 'number' ? retriesLeft + 1 : 1);
    const timeoutMs = options.timeoutMs;
    const maxDurationMs = options.maxDurationMs;
    const maxRuns = options.maxRuns;
    const handlerName = options.handler ?? null;
    const resumable = type === 'http' || !!handlerName;
    if (!resumable && taskFn && this.debug) {
      // Anonymous handlers cannot be resumed; documented in README.
    }

    const configValue = options.config != null
      ? (typeof options.config === 'string' ? options.config : JSON.stringify(options.config))
      : null;
    let storedConfig = configValue;
    if (storedConfig && this.encryptConfigs) {
      if (!this.encryptionKey) {
        throw new EncryptionKeyRequiredError('Cannot encrypt configs without an explicit encryptionKey.');
      }
      storedConfig = encryptConfig(storedConfig, this.encryptionKey);
    }

    const payload = options.payload != null ? JSON.stringify(options.payload) : null;
    const runAt = options.runAt instanceof Date ? options.runAt.toISOString() : (options.runAt as string | undefined) ?? new Date(this.nowFn()).toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        runAt, interval, priority, retriesLeft, type, config, webhookUrl,
        handler_name, payload, max_attempts, timeout_ms, max_duration_ms, max_runs,
        resumable, retry_policy, backoff_ms, backoff_multiplier, jitter, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `);
    const result = stmt.run(
      runAt,
      options.interval ?? null,
      options.priority ?? 0,
      typeof retriesLeft === 'number' ? retriesLeft : Math.max(0, maxAttempts - 1),
      type || 'custom',
      storedConfig,
      options.webhookUrl ?? null,
      handlerName,
      payload,
      maxAttempts,
      timeoutMs ?? null,
      maxDurationMs ?? null,
      maxRuns ?? null,
      resumable ? 1 : 0,
      retry.policy ?? 'transient',
      retry.backoffMs ?? 100,
      retry.backoffMultiplier ?? 2,
      retry.jitter ?? 0.1
    );
    const taskId = Number(result.lastInsertRowid);
    this.memory.set(taskId, {
      fn: taskFn ? (async (ctx: TaskContext) => taskFn.length > 0 ? (taskFn as AnonymousHandler)(ctx) : (taskFn as () => Promise<unknown>)()) : undefined,
      onEnd: options.onEnd
    });
    this.taskCount++;
    return taskId;
  }

  public scheduleHttp(config: { url: string; method?: string; headers?: Record<string, string>; body?: unknown }, options: Record<string, unknown> & ScheduleExtra = {}): number {
    return this.schedule(undefined, { ...options, type: 'http', config });
  }

  private validateConcurrency(value?: number): number {
    const n = value ?? 1;
    if (!Number.isInteger(n) || n < 1) {
      throw new BlazeJobError('concurrency must be an integer >= 1 (process-local)', { code: 'CONFIG', permanent: true });
    }
    return n;
  }

  private validateRate(rate: RateLimitOptions): RateLimitOptions {
    if (!Number.isInteger(rate.maxStarts) || rate.maxStarts < 1 || !Number.isInteger(rate.intervalMs) || rate.intervalMs < 1) {
      throw new BlazeJobError('rate.maxStarts and rate.intervalMs must be integers >= 1 (process-local)', { code: 'CONFIG', permanent: true });
    }
    return rate;
  }

  private isTerminal(status: string): boolean {
    return status === 'success' || status === 'failed' || status === 'cancelled';
  }

  private iso(ms: number = this.nowFn()): string {
    return new Date(ms).toISOString();
  }

  private rateAllowsStart(): boolean {
    if (!this.rate) return true;
    const cutoff = this.nowFn() - this.rate.intervalMs;
    this.startTimestamps = this.startTimestamps.filter((t) => t > cutoff);
    return this.startTimestamps.length < this.rate.maxStarts;
  }

  private recordStart(): void {
    this.startTimestamps.push(this.nowFn());
  }

  private async tick() {
    if (this.shuttingDown || this.closed || !this.db.open) return;
    this.pruneResults();
    if (this.debug) {
      console.log('[BlazeJob] tick', { taskCount: this.taskCount, active: this.activeTasksCount });
    }
    const availableSlots = this.concurrency - this.activeTasksCount;
    if (availableSlots <= 0) return;
    let claimed = 0;
    for (let i = 0; i < availableSlots; i++) {
      if (!this.rateAllowsStart()) break;
      const row = this.claimOne();
      if (!row) break;
      this.recordStart();
      claimed++;
      this.activeTasksCount++;
      void this.runClaimed(row).finally(() => {
        this.activeTasksCount--;
      });
    }
    if (claimed === availableSlots && !this.tickScheduled) {
      this.tickScheduled = true;
      setImmediate(() => {
        this.tickScheduled = false;
        if (this.timer) void this.tick();
      });
    }
  }

  private claimOne(): TaskRow | null {
    const now = this.iso();
    const leaseUntil = this.iso(this.nowFn() + this.leaseMs);
    const tx = this.db.transaction(() => {
      const candidate = this.db.prepare(`
        SELECT * FROM tasks
        WHERE (
          status = 'pending' AND runAt <= @now AND (backoff_until IS NULL OR backoff_until <= @now)
        ) OR (
          status = 'running' AND lease_until IS NOT NULL AND lease_until <= @now
        )
        ORDER BY priority DESC, runAt ASC
        LIMIT 1
      `).get({ now }) as TaskRow | undefined;
      if (!candidate) return null;
      const result = this.db.prepare(`
        UPDATE tasks
        SET status = 'running', lease_until = @leaseUntil, worker_id = @workerId, started_at = COALESCE(started_at, @started)
        WHERE id = @id AND (
          (status = 'pending' AND runAt <= @now AND (backoff_until IS NULL OR backoff_until <= @now))
          OR (status = 'running' AND lease_until IS NOT NULL AND lease_until <= @now)
        )
      `).run({ leaseUntil, workerId: this.workerId, started: now, id: candidate.id, now });
      if (result.changes !== 1) return null;
      return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(candidate.id) as TaskRow;
    });
    return tx();
  }

  private async runClaimed(task: TaskRow): Promise<void> {
    const mem = this.memory.get(task.id) ?? {};
    const abort = new AbortController();
    mem.abort = abort;
    this.memory.set(task.id, mem);

    const timeoutMs = task.timeout_ms ?? undefined;
    let timeout: NodeJS.Timeout | undefined;
    let timedOut = false;
    if (timeoutMs && timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, timeoutMs);
    }

    const attempt = (task.attempt_count ?? 0) + 1;
    this.db.prepare(`UPDATE tasks SET attempt_count = ? WHERE id = ?`).run(attempt, task.id);

    const createdMs = task.created_at ? Date.parse(task.created_at) : this.nowFn();
    if (task.max_duration_ms && this.nowFn() - createdMs > task.max_duration_ms) {
      this.finalize(task.id, 'failed', null, {
        name: 'MaxDurationError',
        message: 'Task exceeded maxDurationMs',
        code: 'MAX_DURATION',
        permanent: true
      }, task);
      if (timeout) clearTimeout(timeout);
      return;
    }

    try {
      if (abort.signal.aborted) throw new TaskCancelledError();
      const result = await this.executeTask(task, abort.signal, attempt);
      if (abort.signal.aborted) throw new TaskCancelledError();
      this.completeSuccess(task, result);
    } catch (err) {
      await this.handleFailure(task, err, abort.signal, attempt, timedOut, mem);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async executeTask(task: TaskRow, signal: AbortSignal, attempt: number): Promise<unknown> {
    const mem = this.memory.get(task.id);
    if (task.type === 'http') {
      const decrypted = decryptConfig(task.config, this.encryptionKey);
      let config: any = decrypted;
      if (typeof config === 'string') {
        try { config = JSON.parse(config); } catch { /* keep */ }
      }
      if (typeof config === 'string') {
        try { config = JSON.parse(config); } catch { /* keep */ }
      }
      return executeHttpTask(config, signal, this.nowFn);
    }

    const ctx: TaskContext = {
      taskId: task.id,
      attempt,
      signal,
      payload: task.payload ? parseMaybeJson(task.payload) : undefined
    };

    if (task.handler_name) {
      const handler = this.handlers.get(task.handler_name);
      if (!handler) throw new MissingHandlerError(task.handler_name);
      return handler(ctx.payload, ctx);
    }

    if (mem?.fn) {
      return mem.fn(ctx);
    }

    if (task.resumable === 0) {
      throw new NonResumableTaskError();
    }
    throw new MissingHandlerError(task.handler_name || '(anonymous)');
  }

  private completeSuccess(task: TaskRow, result: unknown): void {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as TaskRow;
    if (row.status === 'cancelled') {
      this.finalize(task.id, 'cancelled', result, toStructuredError(new TaskCancelledError()), row);
      return;
    }
    const runCount = (row.run_count ?? 0) + 1;
    const isOverMaxRuns = row.max_runs != null && runCount >= row.max_runs;
    const createdMs = row.created_at ? Date.parse(row.created_at) : this.nowFn();
    const isOverMaxDuration = row.max_duration_ms != null && this.nowFn() - createdMs > row.max_duration_ms;
    if (typeof row.interval === 'number' && row.interval > 0 && !isOverMaxRuns && !isOverMaxDuration) {
      const nextRunAt = this.iso(this.nowFn() + row.interval);
      const resultJson = this.persistResults ? jsonSafe(result, this.maxResultBytes) : null;
      this.db.prepare(`
        UPDATE tasks SET status = 'pending', runAt = ?, run_count = ?, result_json = ?, error_json = NULL,
          lastError = NULL, lease_until = NULL, executed_at = ?, result_stored_at = ?
        WHERE id = ?
      `).run(nextRunAt, runCount, resultJson, this.iso(), this.iso(), task.id);
      this.notify(this.getTask(task.id)!);
      return;
    }
    this.db.prepare(`UPDATE tasks SET run_count = ? WHERE id = ?`).run(runCount, task.id);
    this.finalize(task.id, 'success', result, null, { ...row, run_count: runCount });
  }

  private async handleFailure(
    task: TaskRow,
    err: unknown,
    signal: AbortSignal,
    attempt: number,
    timedOut: boolean,
    mem: MemoryState
  ): Promise<void> {
    const structured = toStructuredError(err);
    if (err instanceof BlazeJobError && err.result != null && this.persistResults) {
      this.db.prepare(`UPDATE tasks SET result_json = ? WHERE id = ?`).run(jsonSafe(err.result, this.maxResultBytes), task.id);
    }
    if (err instanceof MissingHandlerError) {
      this.db.prepare(`
        UPDATE tasks SET status = 'blocked', lastError = ?, error_json = ?, lease_until = NULL
        WHERE id = ?
      `).run(structured.message, JSON.stringify(structured), task.id);
      this.notify(this.getTask(task.id)!);
      return;
    }
    if (err instanceof NonResumableTaskError) {
      this.finalize(task.id, 'failed', null, structured, task);
      return;
    }
    if (timedOut) {
      structured.name = 'TaskTimeoutError';
      structured.code = 'TIMEOUT';
      structured.message = `Task execution exceeded timeoutMs=${task.timeout_ms}`;
      structured.permanent = false;
    } else if (err instanceof TaskCancelledError || signal.aborted || mem.abort?.signal.aborted) {
      this.finalize(task.id, 'cancelled', null, toStructuredError(new TaskCancelledError()), task);
      return;
    }

    const maxAttempts = task.max_attempts ?? ((task.retriesLeft ?? 0) + 1);
    const policy = (task.retry_policy as RetryPolicyName) || 'transient';
    const retriesLeft = Math.max(0, (task.retriesLeft ?? Math.max(0, maxAttempts - attempt)));
    const canRetry = attempt < maxAttempts && retriesLeft > 0 && shouldRetry(structured, policy);

    if (canRetry) {
      const delay = computeBackoffMs(attempt, {
        backoffMs: task.backoff_ms ?? 100,
        backoffMultiplier: task.backoff_multiplier ?? 2,
        jitter: task.jitter ?? 0.1,
        retryAfterMs: structured.retryAfterMs
      });
      const next = this.iso(this.nowFn() + delay);
      this.db.prepare(`
        UPDATE tasks SET status = 'pending', retriesLeft = ?, lastError = ?, error_json = ?,
          runAt = ?, backoff_until = ?, lease_until = NULL, error_count = COALESCE(error_count,0) + 1
        WHERE id = ?
      `).run(retriesLeft - 1, structured.message, JSON.stringify(structured), next, next, task.id);
      this.notify(this.getTask(task.id)!);
      this.sendWebhookSafe(task, 'pending', null, structured);
      return;
    }
    this.finalize(task.id, 'failed', null, structured, task);
  }

  private finalize(taskId: number, status: TaskStatus, result: unknown, error: StructuredError | null, row: TaskRow): void {
    const resultJson = this.persistResults && result !== undefined ? jsonSafe(result, this.maxResultBytes) : null;
    this.db.prepare(`
      UPDATE tasks SET status = ?, executed_at = ?, result_json = ?, error_json = ?, lastError = ?,
        lease_until = NULL, result_stored_at = ?, error_count = CASE WHEN ? IS NOT NULL THEN COALESCE(error_count,0)+1 ELSE error_count END
      WHERE id = ?
    `).run(
      status,
      this.iso(),
      resultJson,
      error ? JSON.stringify(error) : null,
      error?.message ?? null,
      this.iso(),
      error && status === 'failed' ? 1 : null,
      taskId
    );
    const snap = this.getTask(taskId);
    if (snap) this.notify(snap);
    const mem = this.memory.get(taskId);
    try {
      mem?.onEnd?.({ runCount: row.run_count ?? snap?.runCount ?? 0, errorCount: (row.error_count ?? 0) + (status === 'failed' ? 1 : 0) });
    } catch (observerErr) {
      if (this.debug) console.error('[BlazeJob] onEnd error', observerErr);
    }
    this.sendWebhookSafe(row, status, result, error);
    this.cleanupMemory(taskId);
    this.taskCount = Math.max(0, this.taskCount - 1);
    if (this.taskCount === 0 && this.onAllTasksEndedCb) {
      try { this.onAllTasksEndedCb(); } catch (e) { if (this.debug) console.error(e); }
    }
    if (this.taskCount === 0 && this.autoExit) {
      this.stop();
      if (this.db.open) this.db.close();
    }
  }

  private cleanupMemory(taskId: number): void {
    this.memory.delete(taskId);
    this.waiters.delete(taskId);
  }

  private notify(snapshot: TaskSnapshot): void {
    for (const observer of this.observers) {
      try { observer(snapshot); } catch (e) {
        if (this.debug) console.error('[BlazeJob] observer error', e);
      }
    }
    const waiters = this.waiters.get(snapshot.id);
    if (waiters) {
      for (const w of [...waiters]) {
        try { w(snapshot); } catch (e) {
          if (this.debug) console.error('[BlazeJob] waiter error', e);
        }
      }
    }
  }

  private sendWebhookSafe(task: TaskRow, status: string, result: unknown, error: StructuredError | null): void {
    if (!task.webhookUrl) return;
    const payload = {
      taskId: task.id,
      status,
      executedAt: this.iso(),
      result: status === 'success' ? 'success' : status === 'pending' ? 'retry' : 'error',
      output: result ?? null,
      error: error?.message ?? null
    };
    void fetch(task.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => undefined);
  }

  private pruneResults(): void {
    if (!this.resultTtlMs) return;
    const cutoff = this.iso(this.nowFn() - this.resultTtlMs);
    this.db.prepare(`
      UPDATE tasks SET result_json = NULL WHERE result_stored_at IS NOT NULL AND result_stored_at < ?
    `).run(cutoff);
  }

  private toSnapshot(row: TaskRow): TaskSnapshot {
    return {
      id: row.id,
      status: row.status as TaskStatus,
      type: row.type || 'custom',
      result: row.result_json ? parseMaybeJson(row.result_json) : null,
      error: row.error_json ? parseMaybeJson(row.error_json) as StructuredError : (row.lastError ? { name: 'Error', message: row.lastError } : null),
      executedAt: row.executed_at,
      startedAt: row.started_at,
      createdAt: row.created_at,
      attempts: row.attempt_count ?? 0,
      runCount: row.run_count ?? 0,
      handlerName: row.handler_name,
      resumable: row.resumable !== 0
    };
  }

  private removeWaiter(id: number, fn: (s: TaskSnapshot) => void): void {
    const list = this.waiters.get(id);
    if (!list) return;
    this.waiters.set(id, list.filter((w) => w !== fn));
  }

  static async sendWebhook(url: string, payload: unknown) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch {
      // ignore
    }
  }
}

export function countProcessSignalHandlers(): { SIGINT: number; SIGTERM: number } {
  return {
    SIGINT: process.listenerCount('SIGINT'),
    SIGTERM: process.listenerCount('SIGTERM')
  };
}
