import type { BatchResult } from '../adapter/batch-result';
import type { Change } from '../adapter/change';
import type { SoapLoadOperation } from './soap-load-operation';
import type { SoapOperation } from './soap-operation';

export interface SoapOperations<T, K> {
  load: SoapLoadOperation<T>;
  /** Without it, the row is looked for among the loaded rows. */
  byKey?: SoapOperation<[key: K], T | undefined>;
  /** Default read: the saved row, or the new key when the operation returns only that. */
  insert?: SoapOperation<[values: Partial<T>], Partial<T> | void>;
  /** `original` is the row as it was read; most services take the whole row. */
  update?: SoapOperation<[key: K, changes: Partial<T>, original: T | undefined], Partial<T> | void>;
  remove?: SoapOperation<[key: K, original: T | undefined], void>;
  /** Many changes in one call; it also saves single changes the operations above do not cover. Without `read` every change counts as saved. */
  save?: SoapOperation<[changes: readonly Change<T, K>[]], BatchResult<T>[]>;
}
