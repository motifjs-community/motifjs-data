import type { DataOperation } from './data-operation';

export interface DataErrorOptions {
  operation: DataOperation;
  /** The backend's own message, used instead of the code's text. */
  message?: string;
  status?: number;
  fields?: Readonly<Record<string, string>>;
  details?: unknown;
  cause?: unknown;
}
