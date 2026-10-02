import { BlazeJobError } from './errors';
import { RetryPolicyName, StructuredError } from './types';

export function toStructuredError(err: unknown): StructuredError {
  if (err instanceof BlazeJobError) {
    return {
      name: err.name,
      message: err.message,
      code: err.code,
      statusCode: err.statusCode,
      retryAfterMs: err.retryAfterMs,
      permanent: err.permanent,
      result: err.result
    };
  }
  if (err instanceof Error) {
    return { name: err.name, message: err.message, permanent: false };
  }
  return { name: 'Error', message: String(err), permanent: false };
}

export function shouldRetry(error: StructuredError, policy: RetryPolicyName): boolean {
  if (policy === 'none') return false;
  if (error.permanent) return false;
  if (error.code === 'CANCELLED' || error.code === 'NON_RESUMABLE' || error.code === 'MISSING_HANDLER') {
    return false;
  }
  if (policy === 'all') return true;
  const status = error.statusCode;
  if (status == null) return true;
  if (status === 408 || status === 425 || status === 429) return true;
  if (status >= 500) return true;
  return false;
}

export function computeBackoffMs(
  attempt: number,
  options: { backoffMs: number; backoffMultiplier: number; jitter: number; retryAfterMs?: number },
  random: () => number = Math.random
): number {
  if (options.retryAfterMs != null && Number.isFinite(options.retryAfterMs)) {
    return Math.max(0, options.retryAfterMs);
  }
  const base = options.backoffMs * Math.pow(options.backoffMultiplier, Math.max(0, attempt - 1));
  const jitterSpan = base * options.jitter;
  return Math.max(0, base + (random() * 2 - 1) * jitterSpan);
}

export function parseRetryAfter(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}
