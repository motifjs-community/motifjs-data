import type { DataErrorKind } from './data-error-kind';

// 1xx: the request, 2xx: the backend's answer, 3xx: how the adapter was used.
export const DATA_ERRORS = {
  MJD101: { kind: 'network', text: () => 'The backend could not be reached.' },
  MJD102: { kind: 'timeout', text: (ms: number) => (Number.isFinite(ms) ? `No answer in ${ms} ms.` : 'No answer in time.') },
  MJD103: { kind: 'http', text: (status: number, statusText: string) => `The backend answered ${status}${statusText ? ` ${statusText}` : ''}.` },
  MJD104: { kind: 'parse', text: (what: string) => `The answer could not be read: ${what}.` },
  MJD105: { kind: 'abort', text: () => 'The request was cancelled.' },
  MJD106: { kind: 'abort', text: () => 'Cancelled by an event listener.' },
  MJD107: { kind: 'held', text: () => 'Not sent: the backend failed repeatedly; requests are paused for a while.' },
  MJD108: { kind: 'held', text: () => 'Not sent: too many requests are waiting.' },
  MJD109: { kind: 'held', text: () => 'Not sent: the request rate limit is reached.' },
  MJD201: { kind: 'server', text: (message: string) => message || 'The backend reported an error.' },
  MJD202: { kind: 'validation', text: (message: string) => message || 'The backend rejected the values.' },
  MJD203: { kind: 'conflict', text: () => 'A row with this key exists.' },
  MJD204: { kind: 'not-found', text: () => 'No row with this key.' },
  MJD205: { kind: 'conflict', text: (message: string) => message || 'The row was changed elsewhere since it was read.' },
  MJD301: { kind: 'unsupported', text: (what: string) => `This adapter cannot ${what}.` },
  MJD302: { kind: 'invalid', text: (detail: string) => `Invalid options: ${detail}.` },
  MJD303: { kind: 'key', text: () => 'The adapter needs a `key` setting for this.' },
  MJD304: { kind: 'key', text: () => 'The new row has no key.' },
  MJD305: { kind: 'invalid', text: () => 'The backend needs the row as it was read (`original`) to save this change.' },
} as const satisfies Record<string, { kind: DataErrorKind; text: (...args: never[]) => string }>;
