import { DataError } from '../errors/data-error';
import type { HttpResponse } from './http-response';

/** No answer, a timeout, or status 408, 429 or 5xx. */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof DataError)) return error instanceof TypeError;
  if (error.kind === 'network' || error.kind === 'timeout') return true;
  const status = error.status ?? 0;
  return error.kind === 'http' && (status === 408 || status === 429 || status >= 500);
}

/**
 * Reads `message`, `error`, `error.message` or `title`, and messages by field: `errors` as an object
 * (ASP.NET problem details) or `error.details` as `[{ target, message }]` (OData).
 */
export function readErrorBody(body: unknown, textLength = 300): { message: string; fields?: Record<string, string> } {
  if (typeof body === 'string') return { message: body.length > textLength ? `${body.slice(0, Math.max(0, textLength))}…` : body };
  if (!body || typeof body !== 'object') return { message: '' };
  const b = body as Record<string, unknown>;
  const inner = b.error && typeof b.error === 'object' ? (b.error as Record<string, unknown>) : undefined;
  const message = [b.message, inner?.message, b.error, b.title].find((m): m is string => typeof m === 'string' && m !== '') ?? '';
  const errors = b.errors ?? inner?.details;
  if (!errors || typeof errors !== 'object') return { message };

  const fields: Record<string, string> = {};
  const add = (field: string, text: string) => (fields[field] = fields[field] ? `${fields[field]} ${text}` : text);
  if (Array.isArray(errors)) {
    for (const e of errors) if (e && typeof e.target === 'string' && e.target) add(e.target, String(e.message ?? ''));
  } else {
    for (const [field, value] of Object.entries(errors)) add(field, Array.isArray(value) ? value.join(' ') : String(value));
  }
  return Object.keys(fields).length ? { message, fields } : { message };
}

export function errorForStatus(response: HttpResponse, message: string, fields?: Record<string, string>): DataError {
  const operation = response.request.operation;
  const options = { operation, status: response.status, fields, details: response.body };
  switch (response.status) {
    case 400:
    case 422:
      if (message || fields) return DataError.create('MJD202', options, message);
      break;
    case 404:
      if (operation === 'byKey' || operation === 'update' || operation === 'remove') return DataError.create('MJD204', { ...options, message });
      break;
    case 409:
      return DataError.create('MJD203', { ...options, message });
    case 412:
      return DataError.create('MJD205', options, message);
    case 428:
      return DataError.create('MJD305', options);
  }
  return DataError.create('MJD103', { ...options, message }, response.status, response.statusText);
}
