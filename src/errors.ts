export class BlazeJobError extends Error {
  code: string;
  permanent: boolean;
  statusCode?: number;
  retryAfterMs?: number;
  result?: unknown;

  constructor(
    message: string,
    options: { code?: string; permanent?: boolean; statusCode?: number; retryAfterMs?: number; result?: unknown } = {}
  ) {
    super(message);
    this.name = 'BlazeJobError';
    this.code = options.code ?? 'BLAZEJOB';
    this.permanent = options.permanent ?? false;
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
    this.result = options.result;
  }
}

export class MissingHandlerError extends BlazeJobError {
  constructor(handlerName: string) {
    super(`Named handler "${handlerName}" is not registered. Re-register it to resume the task.`, {
      code: 'MISSING_HANDLER',
      permanent: false
    });
    this.name = 'MissingHandlerError';
  }
}

export class NonResumableTaskError extends BlazeJobError {
  constructor() {
    super('Anonymous in-memory handlers cannot be resumed after restart. Register a named handler with a JSON payload.', {
      code: 'NON_RESUMABLE',
      permanent: true
    });
    this.name = 'NonResumableTaskError';
  }
}

export class EncryptionKeyRequiredError extends BlazeJobError {
  constructor(detail: string) {
    super(detail, { code: 'ENCRYPTION_KEY_REQUIRED', permanent: true });
    this.name = 'EncryptionKeyRequiredError';
  }
}

export class TaskTimeoutError extends BlazeJobError {
  constructor(timeoutMs: number) {
    super(`Task execution exceeded timeoutMs=${timeoutMs}`, {
      code: 'TIMEOUT',
      permanent: false
    });
    this.name = 'TaskTimeoutError';
  }
}

export class TaskCancelledError extends BlazeJobError {
  constructor() {
    super('Task was cancelled', { code: 'CANCELLED', permanent: true });
    this.name = 'TaskCancelledError';
  }
}
