import { MotifError } from '@motifx/core';
import type { DataErrorCode } from './data-error-code';
import { DATA_ERRORS } from './data-error-codes';
import type { DataErrorKind } from './data-error-kind';
import type { DataErrorOptions } from './data-error-options';
import type { DataOperation } from './data-operation';

// MotifError types `code` as the core's MJX codes only (CORE-REPORTS R25), so the subclass sees it as a string.
const MotifErrorWithCode = MotifError as unknown as new (code: string, message: string, options?: { cause?: unknown }) => Error & {
  readonly code: string;
};

export class DataError extends MotifErrorWithCode {
  declare readonly code: DataErrorCode;
  readonly kind: DataErrorKind;
  readonly operation: DataOperation;
  /** The message without the `[motifjs-data] MJD…:` prefix. */
  readonly plainMessage: string;
  readonly status?: number;
  readonly fields?: Readonly<Record<string, string>>;
  readonly details?: unknown;

  constructor(code: DataErrorCode, plainMessage: string, options: DataErrorOptions) {
    super(code, `[motifjs-data] ${code}: ${plainMessage}`, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DataError';
    this.kind = DATA_ERRORS[code].kind;
    this.operation = options.operation;
    this.plainMessage = plainMessage;
    this.status = options.status;
    this.fields = options.fields;
    this.details = options.details;
  }

  static create<C extends DataErrorCode>(code: C, options: DataErrorOptions, ...args: Parameters<(typeof DATA_ERRORS)[C]['text']>): DataError {
    const text = (DATA_ERRORS[code].text as (...a: unknown[]) => string)(...args);
    return new DataError(code, options.message || text, options);
  }

  static from(error: unknown, operation: DataOperation): DataError {
    if (error instanceof DataError) return error;
    if (isAbortError(error)) return DataError.create('MJD105', { operation, cause: error });
    if (error instanceof MotifError) {
      // Errors of the core's Resilience policies.
      switch ((error as { code: string }).code) {
        case 'MJX605':
          return DataError.create('MJD102', { operation, cause: error }, Number.NaN);
        case 'MJX602':
          return DataError.create('MJD107', { operation, cause: error });
        case 'MJX603':
          return DataError.create('MJD108', { operation, cause: error });
        case 'MJX604':
          return DataError.create('MJD109', { operation, cause: error });
      }
    }
    if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
      return DataError.create('MJD101', { operation, message: error.message, cause: error });
    }
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    return DataError.create('MJD201', { operation, cause: error }, message);
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DataError) return error.kind === 'abort';
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}
