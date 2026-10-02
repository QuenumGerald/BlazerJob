import { BlazeJobError } from '../errors';
import { parseRetryAfter } from '../retry';
import { HttpTaskConfig, HttpTaskResult } from '../types';

const STORED_HEADER_ALLOWLIST = new Set([
  'content-type',
  'content-length',
  'retry-after',
  'date',
  'etag',
  'cache-control',
  'x-request-id'
]);

export function sanitizeStoredHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = headers instanceof Headers ? headers.entries() : Object.entries(headers);
  for (const [key, value] of entries) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie' || lower === 'set-cookie' || lower === 'proxy-authorization') {
      continue;
    }
    if (STORED_HEADER_ALLOWLIST.has(lower) || lower.startsWith('x-')) {
      out[lower] = value;
    }
  }
  return out;
}

export async function executeHttpTask(
  cfg: HttpTaskConfig,
  signal: AbortSignal,
  now: () => number
): Promise<HttpTaskResult> {
  if (!cfg?.url) {
    throw new BlazeJobError('HTTP task is missing url', { code: 'HTTP_CONFIG', permanent: true });
  }
  const method = (cfg.method ?? 'GET').toUpperCase();
  const headers = { ...(cfg.headers ?? {}) };
  let body: string | undefined;
  if (cfg.body !== undefined && cfg.body !== null && method !== 'GET' && method !== 'HEAD') {
    if (typeof cfg.body === 'string') body = cfg.body;
    else {
      body = JSON.stringify(cfg.body);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }
  }
  const res = await fetch(cfg.url, { method, headers, body, signal });
  const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), now());
  const raw = await res.text();
  let parsed: unknown = raw;
  let bodyType: HttpTaskResult['bodyType'] = 'text';
  if (raw.length === 0) {
    parsed = null;
    bodyType = 'empty';
  } else {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('json') || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
      try {
        parsed = JSON.parse(raw);
        bodyType = 'json';
      } catch {
        parsed = raw;
        bodyType = 'text';
      }
    }
  }
  const result: HttpTaskResult = {
    status: res.status,
    ok: res.ok,
    headers: sanitizeStoredHeaders(res.headers),
    body: parsed,
    bodyType
  };
  if (!res.ok) {
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 425 && res.status !== 429;
    throw new BlazeJobError(`HTTP ${res.status} for ${cfg.url}`, {
      code: 'HTTP_STATUS',
      statusCode: res.status,
      permanent,
      retryAfterMs,
      result
    });
  }
  return result;
}

/** @deprecated Prefer executeHttpTask; kept for compatibility with older internals. */
export function makeHttpTaskFn(cfg: HttpTaskConfig) {
  return async () => {
    await executeHttpTask(cfg, new AbortController().signal, () => Date.now());
  };
}
