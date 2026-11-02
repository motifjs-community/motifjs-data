import type { EventArgs } from '@motifx/core';
import type { DataError } from '../errors/data-error';
import type { LoadOptions } from '../query/load-options';
import type { LoadResult } from '../query/load-result';
import type { PushedChange } from './pushed-change';

// "…ing" events can change what is sent, or stop the operation with `cancel = true`.
export interface AdapterEvents<T, K> {
  loading: EventArgs & { options: LoadOptions };
  loaded: { options: LoadOptions; result: LoadResult<T> };
  inserting: EventArgs & { values: Partial<T> };
  inserted: { values: Partial<T>; key: K; row: T };
  updating: EventArgs & { key: K; changes: Partial<T> };
  updated: { key: K; changes: Partial<T>; row: Partial<T> };
  removing: EventArgs & { key: K };
  removed: { key: K };
  changed: { changes: PushedChange<T, K>[]; source: 'write' | 'push' };
  error: { error: DataError };
}
