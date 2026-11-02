import type { HttpRequest } from './http-request';

/** An answer before the adapter reads it; `afterReceive` may change `status` or `body`, or throw. */
export interface HttpResponse {
  readonly request: HttpRequest;
  status: number;
  statusText: string;
  readonly headers: Headers;
  /** Parsed JSON, text, or `null` when empty. */
  body: unknown;
  readonly durationMs: number;
}
