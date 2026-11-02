import type { DataError } from '../errors/data-error';
import type { Change } from './change';

export type SaveOutcome<T, K = unknown> =
  | { change: Change<T, K>; ok: true; key: K; row?: Partial<T> }
  | { change: Change<T, K>; ok: false; error: DataError };
