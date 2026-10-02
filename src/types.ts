export type TaskType = 'http' | 'custom';

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'blocked';

export interface HttpTaskConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export type TaskConfig = HttpTaskConfig;

export type RetryPolicyName = 'all' | 'transient' | 'none';

export interface RetryOptions {
  /** Maximum execution attempts (initial try included). Default: retriesLeft + 1 or 1. */
  maxAttempts?: number;
  backoffMs?: number;
  backoffMultiplier?: number;
  jitter?: number;
  policy?: RetryPolicyName;
}

export interface TaskContext {
  taskId: number;
  attempt: number;
  signal: AbortSignal;
  payload: unknown;
}

export type NamedHandler = (payload: unknown, ctx: TaskContext) => Promise<unknown>;
export type AnonymousHandler = (ctx: TaskContext) => Promise<unknown>;

export interface StructuredError {
  name: string;
  message: string;
  code?: string;
  statusCode?: number;
  retryAfterMs?: number;
  permanent?: boolean;
  result?: unknown;
}

export interface HttpTaskResult {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: unknown;
  bodyType: 'json' | 'text' | 'empty';
}

export interface TaskSnapshot {
  id: number;
  status: TaskStatus;
  type: string;
  result: unknown;
  error: StructuredError | null;
  executedAt: string | null;
  startedAt: string | null;
  createdAt: string | null;
  attempts: number;
  runCount: number;
  handlerName: string | null;
  resumable: boolean;
}

export interface ScheduleExtra {
  maxRuns?: number;
  maxDurationMs?: number;
  timeoutMs?: number;
  onEnd?: (stats: { runCount: number; errorCount: number }) => void;
  handler?: string;
  payload?: unknown;
  retry?: RetryOptions;
}

export type OnTaskEnd = (taskId: number, stats: { runCount: number; errorCount: number }) => void;
export type OnAllTasksEnded = () => void;
export type TaskObserver = (snapshot: TaskSnapshot) => void;

export interface RateLimitOptions {
  /** Maximum number of task starts allowed in `intervalMs`. Local to this process. */
  maxStarts: number;
  intervalMs: number;
}

export interface ResultRetentionOptions {
  maxBytes?: number;
  ttlMs?: number;
}

export interface BlazeJobOptions {
  dbPath?: string;
  storage?: 'sqlite' | 'memory';
  autoExit?: boolean;
  concurrency?: number;
  /** Process-local start rate limit. */
  rate?: RateLimitOptions;
  encryptionKey?: string;
  encryptConfigs?: boolean;
  debug?: boolean;
  persistResults?: boolean;
  resultRetention?: ResultRetentionOptions;
  /** Lease duration for running tasks (recovery). Default 30s. */
  leaseMs?: number;
  workerId?: string;
  /** Injected clock for tests. */
  now?: () => number;
}
