import type { BatchResult } from '../adapter/batch-result';
import type { Change } from '../adapter/change';

/** An endpoint that takes many changes in one request. */
export interface RestBatch<T, K> {
  url: string;
  /** Default `'POST'`. */
  method?: string;
  write: (changes: readonly Change<T, K>[]) => unknown;
  /** One result per change, in order. */
  read: (body: unknown, changes: readonly Change<T, K>[]) => BatchResult<T>[];
}
