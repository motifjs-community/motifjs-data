import type { EventArgs } from '@motifx/core';
import type { DataOperation } from '../errors/data-operation';

/** A request before it is sent; `onRequesting` listeners and `beforeSend` may change any part, or `cancel` it. */
export interface HttpRequest extends EventArgs {
  readonly operation: DataOperation;
  method: string;
  /** Without query parameters; those are in `query`. */
  url: string;
  query: URLSearchParams;
  headers: Headers;
  /** Sent as JSON unless `body` is set. */
  data?: unknown;
  body?: BodyInit | null;
  credentials?: RequestCredentials;
  readonly signal: AbortSignal | undefined;
}
