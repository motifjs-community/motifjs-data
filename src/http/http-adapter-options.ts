import type { ResiliencePolicy, RetryOptions } from '@motifx/core';
import type { DataAdapterOptions } from '../adapter/data-adapter-options';
import type { DataError } from '../errors/data-error';
import type { HttpRequest } from './http-request';
import type { HttpResponse } from './http-response';

export interface HttpAdapterOptions<T> extends DataAdapterOptions<T> {
  /** Default: the global `fetch`. */
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  /** A function is called for every request (the current token, for example). */
  headers?: HeadersInit | ((request: HttpRequest) => HeadersInit | Promise<HeadersInit>);
  credentials?: RequestCredentials;
  /** May change the request or cancel it; may be async. */
  beforeSend?: (request: HttpRequest) => void | Promise<void>;
  /** Sees every answer (error statuses too) before the adapter reads it. */
  afterReceive?: (response: HttpResponse) => void | Promise<void>;
  timeoutMs?: number;
  /** Retries only transient failures by default: no answer, timeout, 408, 429, 5xx. */
  retry?: RetryOptions;
  /** A whole core resilience policy, used instead of `retry`. */
  resilience?: ResiliencePolicy;
  /** Reads an error answer (status outside 200–299) in the backend's own format; return nothing to read it the built-in way. */
  readError?: (response: HttpResponse) => DataError | null | undefined | void;
  /** An error answer that is plain text becomes the message up to this many characters (then `…`). Default 300. */
  errorTextLength?: number;
}
