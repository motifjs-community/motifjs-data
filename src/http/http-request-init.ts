import type { DataOperation } from '../errors/data-operation';

export interface HttpRequestInit {
  operation: DataOperation;
  method: string;
  url: string;
  query?: Record<string, string | number | boolean | null | undefined> | URLSearchParams;
  headers?: HeadersInit;
  data?: unknown;
  body?: BodyInit | null;
  signal?: AbortSignal;
}
