import type { DataAdapterOptions } from '../adapter/data-adapter-options';

export interface ArrayAdapterOptions<T> extends DataAdapterOptions<T> {
  /** A function is read on every operation, so the array can be replaced. */
  data: T[] | (() => T[]);
  /** Gives a new row without a key its key (single-field keys only). */
  createKey?: (values: Partial<T>, rows: readonly T[]) => unknown;
}
