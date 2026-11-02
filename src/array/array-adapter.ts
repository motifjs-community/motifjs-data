import { DataAdapter } from '../adapter/data-adapter';
import type { Capabilities } from '../adapter/capabilities';
import type { PushedChange } from '../adapter/pushed-change';
import { DataError } from '../errors/data-error';
import { queryArray } from '../query/local-query';
import type { LoadOptions } from '../query/load-options';
import type { LoadResult } from '../query/load-result';
import type { ArrayAdapterOptions } from './array-adapter-options';

/** Rows in an array. Loads return the row objects themselves; writes change the array in place, and an insert stores the given object. */
export class ArrayAdapter<T extends object = Record<string, unknown>, K = unknown> extends DataAdapter<T, K> {
  private readonly data: T[] | (() => T[]);
  private readonly createKey?: (values: Partial<T>, rows: readonly T[]) => unknown;

  constructor(options: ArrayAdapterOptions<T>) {
    super(options);
    this.data = options.data;
    this.createKey = options.createKey;
  }

  get rows(): T[] {
    return typeof this.data === 'function' ? this.data() : this.data;
  }

  protected backendCapabilities(): Capabilities {
    return { filter: true, sort: true, paging: true, count: true, select: true, group: true, summary: true, insert: true, update: true, remove: true };
  }

  protected loadRows(options: LoadOptions): Promise<LoadResult<T>> {
    return Promise.resolve(queryArray(this.rows, options, this.evaluateContext));
  }

  protected override countRows(options: LoadOptions): Promise<number> {
    return Promise.resolve(queryArray(this.rows, { filter: options.filter, count: true, take: 0 }, this.evaluateContext).total ?? 0);
  }

  protected override findRow(key: K): Promise<T | undefined> {
    const at = this.indexOf(key);
    return Promise.resolve(at < 0 ? undefined : this.rows[at]);
  }

  // The given object itself goes into the array; a new key is written onto it.
  protected override insertRow(values: Partial<T>): Promise<Partial<T>> {
    const rows = this.rows;
    const row = values as T;
    if (this.keys.isSet) {
      const fields = this.keys.fields;
      const needsKey = !this.keys.hasKey(row);
      if (needsKey && (!this.createKey || fields?.length !== 1)) return Promise.reject(DataError.create('MJD304', { operation: 'insert' }));
      const key = needsKey ? this.createKey!(values, rows) : this.keys.keyOf(row);
      if (this.indexOf(key as K) >= 0) return Promise.reject(DataError.create('MJD203', { operation: 'insert' }));
      if (needsKey) (row as Record<string, unknown>)[fields![0]] = key;
    }
    rows.push(row);
    return Promise.resolve(row);
  }

  protected override updateRow(key: K, changes: Partial<T>): Promise<Partial<T>> {
    const at = this.indexOf(key);
    if (at < 0) return Promise.reject(DataError.create('MJD204', { operation: 'update' }));
    const row = this.rows[at];
    const newKey = this.keys.keyOf({ ...row, ...changes });
    if (!this.keys.sameKey(newKey, key) && this.indexOf(newKey as K) >= 0) {
      return Promise.reject(DataError.create('MJD203', { operation: 'update' }));
    }
    Object.assign(row, changes);
    return Promise.resolve(row);
  }

  protected override removeRow(key: K): Promise<void> {
    const at = this.indexOf(key);
    if (at < 0) return Promise.reject(DataError.create('MJD204', { operation: 'remove' }));
    this.rows.splice(at, 1);
    return Promise.resolve();
  }

  protected override applyPushedChanges(changes: readonly PushedChange<T, K>[]) {
    const rows = this.rows;
    for (const change of changes) {
      const at = this.indexOf(change.key);
      if (change.type === 'remove') {
        if (at >= 0) rows.splice(at, 1);
      } else if (at >= 0) {
        Object.assign(rows[at], change.data ?? {});
      } else if (change.type === 'insert' && change.data) {
        rows.push(change.data as T);
      }
    }
  }

  private indexOf(key: K): number {
    if (!this.keys.isSet) return -1;
    return this.rows.findIndex((row) => this.keys.sameKey(this.keys.keyOf(row), key));
  }
}
