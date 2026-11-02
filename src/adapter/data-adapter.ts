import { Disposable, DisposableStore, Emitter, type Event as MotifEvent, type EventArgs } from '@motifx/core';
import { DataError } from '../errors/data-error';
import type { DataOperation } from '../errors/data-operation';
import type { EvaluateContext } from '../query/evaluate-context';
import { validateFilter } from '../query/filter-validation';
import type { FieldType } from '../query/field-type';
import { queryArray } from '../query/local-query';
import type { LoadOptions } from '../query/load-options';
import type { LoadResult } from '../query/load-result';
import type { RowGroup } from '../query/row-group';
import type { AdapterEvents } from './adapter-events';
import type { BatchResult } from './batch-result';
import type { ByKeyOptions } from './by-key-options';
import type { Capabilities } from './capabilities';
import type { Change } from './change';
import type { DataAdapterOptions } from './data-adapter-options';
import { splitLoad } from './load-split';
import type { OperationOptions } from './operation-options';
import type { PushedChange } from './pushed-change';
import { RowKeys } from './row-keys';
import type { SaveOutcome } from './save-outcome';
import type { WriteOptions } from './write-options';

const SUMMARY_TYPES = new Set(['count', 'sum', 'min', 'max', 'avg']);

/**
 * Base class of all adapters. A subclass talks to its backend (`loadRows`, `insertRow`, `updateRow`,
 * `removeRow`, optionally `saveBatch`); whatever the backend cannot do (see `backendCapabilities`) is
 * done here in memory.
 */
export abstract class DataAdapter<T = Record<string, unknown>, K = unknown> extends Disposable {
  readonly keys: RowKeys<T>;
  readonly fields: Readonly<Record<string, FieldType>>;
  readonly locale: string | undefined;
  private readonly disabledCapabilities: Partial<Capabilities>;
  private readonly memoryRules: Pick<DataAdapterOptions<T>, 'sortValue' | 'filterValue' | 'compare'>;
  private readonly disposables = new DisposableStore();
  private readonly loadingEmitter = this.disposables.add(new Emitter<AdapterEvents<T, K>['loading']>());
  private readonly loadedEmitter = this.disposables.add(new Emitter<AdapterEvents<T, K>['loaded']>());
  private readonly insertingEmitter = this.disposables.add(new Emitter<AdapterEvents<T, K>['inserting']>());
  private readonly insertedEmitter = this.disposables.add(new Emitter<AdapterEvents<T, K>['inserted']>());
  private readonly updatingEmitter = this.disposables.add(new Emitter<AdapterEvents<T, K>['updating']>());
  private readonly updatedEmitter = this.disposables.add(new Emitter<AdapterEvents<T, K>['updated']>());
  private readonly removingEmitter = this.disposables.add(new Emitter<AdapterEvents<T, K>['removing']>());
  private readonly removedEmitter = this.disposables.add(new Emitter<AdapterEvents<T, K>['removed']>());
  private readonly changedEmitter = this.disposables.add(new Emitter<AdapterEvents<T, K>['changed']>());
  private readonly errorEmitter = this.disposables.add(new Emitter<AdapterEvents<T, K>['error']>());

  readonly onLoading: MotifEvent<AdapterEvents<T, K>['loading']> = this.loadingEmitter.event;
  readonly onLoaded: MotifEvent<AdapterEvents<T, K>['loaded']> = this.loadedEmitter.event;
  readonly onInserting: MotifEvent<AdapterEvents<T, K>['inserting']> = this.insertingEmitter.event;
  readonly onInserted: MotifEvent<AdapterEvents<T, K>['inserted']> = this.insertedEmitter.event;
  readonly onUpdating: MotifEvent<AdapterEvents<T, K>['updating']> = this.updatingEmitter.event;
  readonly onUpdated: MotifEvent<AdapterEvents<T, K>['updated']> = this.updatedEmitter.event;
  readonly onRemoving: MotifEvent<AdapterEvents<T, K>['removing']> = this.removingEmitter.event;
  readonly onRemoved: MotifEvent<AdapterEvents<T, K>['removed']> = this.removedEmitter.event;
  readonly onChanged: MotifEvent<AdapterEvents<T, K>['changed']> = this.changedEmitter.event;
  readonly onError: MotifEvent<AdapterEvents<T, K>['error']> = this.errorEmitter.event;

  constructor(options: DataAdapterOptions<T> = {}) {
    super();
    this.keys = new RowKeys<T>(options.key);
    this.fields = { ...(options.fields ?? {}) };
    this.locale = options.locale;
    this.disabledCapabilities = { ...(options.capabilities ?? {}) };
    this.memoryRules = { sortValue: options.sortValue, filterValue: options.filterValue, compare: options.compare };
  }

  protected abstract backendCapabilities(): Capabilities;

  /** What the backend does itself, minus what the `capabilities` option turned off. */
  get capabilities(): Capabilities {
    const caps = { ...this.backendCapabilities() };
    for (const name of Object.keys(caps) as (keyof Capabilities)[]) {
      if (this.disabledCapabilities[name] === false) caps[name] = false;
    }
    return caps;
  }

  keyOf(row: T | Partial<T>): K {
    this.requireKey('byKey');
    return this.keys.keyOf(row) as K;
  }

  sameKey(a: K, b: K): boolean {
    return this.keys.sameKey(a, b);
  }

  keyString(key: K): string {
    return this.keys.keyString(key);
  }

  override dispose() {
    this.disposables.dispose();
    super.dispose();
  }

  async load(options: LoadOptions = {}): Promise<LoadResult<T>> {
    try {
      const e = { cancel: false, options: this.checkLoadOptions(options, 'load') };
      this.loadingEmitter.fire(e);
      this.throwIfCancelled(e, 'load');
      const checked = this.checkLoadOptions(e.options, 'load');
      const result = await this.query(checked, 'load');
      this.loadedEmitter.fire({ options: checked, result });
      return result;
    } catch (error) {
      throw this.reportFailure(error, 'load');
    }
  }

  async count(options: Pick<LoadOptions, 'filter' | 'params' | 'signal'> = {}): Promise<number> {
    try {
      const checked = this.checkLoadOptions(options, 'count');
      this.throwIfAborted(checked.signal, 'count');
      const total = await this.countRows(checked);
      this.throwIfAborted(checked.signal, 'count');
      return total;
    } catch (error) {
      throw this.reportFailure(error, 'count');
    }
  }

  async byKey(key: K, options: ByKeyOptions = {}): Promise<T | undefined> {
    try {
      this.requireKey('byKey');
      this.throwIfAborted(options.signal, 'byKey');
      const row = await this.findRow(key, options);
      this.throwIfAborted(options.signal, 'byKey');
      return row;
    } catch (error) {
      throw this.reportFailure(error, 'byKey');
    }
  }

  /**
   * Resolves to the saved row: the backend's own object, or the given object itself with the backend's
   * fields (a new key) written onto it.
   */
  async insert(values: Partial<T>, options: OperationOptions = {}): Promise<T> {
    try {
      this.requireCapability('insert', 'insert');
      this.throwIfAborted(options.signal, 'insert');
      const e = { cancel: false, values };
      this.insertingEmitter.fire(e);
      this.throwIfCancelled(e, 'insert');
      const returned = await this.insertRow(e.values, options);
      this.throwIfAborted(options.signal, 'insert');
      const row = savedRow(e.values, returned) as T;
      const key = this.keyOfSaved(row);
      this.insertedEmitter.fire({ values: e.values, key, row });
      this.changedEmitter.fire({ changes: [{ type: 'insert', key, data: row }], source: 'write' });
      return row;
    } catch (error) {
      throw this.reportFailure(error, 'insert');
    }
  }

  async update(key: K, changes: Partial<T>, options: WriteOptions<T> = {}): Promise<Partial<T>> {
    try {
      this.requireCapability('update', 'update');
      this.requireKey('update');
      this.throwIfAborted(options.signal, 'update');
      const e = { cancel: false, key, changes };
      this.updatingEmitter.fire(e);
      this.throwIfCancelled(e, 'update');
      const returned = await this.updateRow(key, e.changes, options);
      this.throwIfAborted(options.signal, 'update');
      const row = savedChanges(e.changes, returned);
      this.updatedEmitter.fire({ key, changes: e.changes, row });
      this.changedEmitter.fire({ changes: [{ type: 'update', key, data: row }], source: 'write' });
      return row;
    } catch (error) {
      throw this.reportFailure(error, 'update');
    }
  }

  async remove(key: K, options: WriteOptions<T> = {}): Promise<void> {
    try {
      this.requireCapability('remove', 'remove');
      this.requireKey('remove');
      this.throwIfAborted(options.signal, 'remove');
      const e = { cancel: false, key };
      this.removingEmitter.fire(e);
      this.throwIfCancelled(e, 'remove');
      await this.removeRow(key, options);
      this.throwIfAborted(options.signal, 'remove');
      this.removedEmitter.fire({ key });
      this.changedEmitter.fire({ changes: [{ type: 'remove', key }], source: 'write' });
    } catch (error) {
      throw this.reportFailure(error, 'remove');
    }
  }

  /**
   * Saves several changes and returns one outcome per change, in order; a failed change does not stop
   * the others. Without `saveBatch`, or for a single change, the changes are sent one by one.
   */
  async save(changes: readonly Change<T, K>[], options: OperationOptions = {}): Promise<SaveOutcome<T, K>[]> {
    const outcomes: SaveOutcome<T, K>[] = new Array(changes.length);
    const toSend: { at: number; change: Change<T, K> }[] = [];
    changes.forEach((change, at) => {
      try {
        toSend.push({ at, change: this.runBeforeEvent(change) });
      } catch (error) {
        outcomes[at] = { change, ok: false, error: DataError.from(error, 'save') };
      }
    });

    const finish = (at: number, sent: Change<T, K>, result: BatchResult<T>) => {
      outcomes[at] = result.ok
        ? this.successOutcome(changes[at], sent, result.row)
        : { change: changes[at], ok: false, error: this.reportFailure(result.error, 'save') };
    };

    if (toSend.length > 1 && this.saveBatch && !options.signal?.aborted) {
      try {
        const results = await this.saveBatch(
          toSend.map((x) => x.change),
          options,
        );
        toSend.forEach((x, i) => finish(x.at, x.change, results[i] ?? { ok: false, error: DataError.create('MJD104', { operation: 'save' }, 'no result for this change') }));
      } catch (error) {
        for (const x of toSend) finish(x.at, x.change, { ok: false, error });
      }
    } else {
      for (const x of toSend) {
        if (options.signal?.aborted) {
          finish(x.at, x.change, { ok: false, error: DataError.create('MJD105', { operation: 'save' }) });
          continue;
        }
        try {
          finish(x.at, x.change, { ok: true, row: await this.sendChange(x.change, options) });
        } catch (error) {
          finish(x.at, x.change, { ok: false, error });
        }
      }
    }

    const saved: PushedChange<T, K>[] = [];
    for (const o of outcomes) {
      if (o.ok) saved.push(o.change.type === 'remove' ? { type: 'remove', key: o.key } : { type: o.change.type, key: o.key, data: o.row });
    }
    if (saved.length) this.changedEmitter.fire({ changes: saved, source: 'write' });
    return outcomes;
  }

  /** Announces changes made elsewhere (another user, a server push) through `onChanged`. */
  push(changes: readonly PushedChange<T, K>[]) {
    if (!changes.length) return;
    this.applyPushedChanges(changes);
    this.changedEmitter.fire({ changes: [...changes], source: 'push' });
  }

  /** Gets only what the backend can do; the rest of the options are applied afterwards in memory. */
  protected abstract loadRows(options: LoadOptions): Promise<LoadResult<T>>;

  protected async countRows(options: LoadOptions): Promise<number> {
    const result = await this.query({ filter: options.filter, params: options.params, signal: options.signal, skip: 0, take: 0, count: true }, 'count');
    return result.total ?? 0;
  }

  protected async findRow(key: K, options: ByKeyOptions): Promise<T | undefined> {
    const filter = this.keys.keyFilter(key);
    if (!filter) {
      // A function key has no field to filter on.
      const { rows } = await this.query({ expand: options.expand, params: options.params, signal: options.signal }, 'byKey');
      return rows.find((r) => this.keys.sameKey(this.keys.keyOf(r), key));
    }
    const { rows } = await this.query({ filter, take: 1, select: options.select, expand: options.expand, params: options.params, signal: options.signal }, 'byKey');
    return rows[0];
  }

  protected insertRow(_values: Partial<T>, _options: OperationOptions): Promise<Partial<T> | void> {
    return Promise.reject(DataError.create('MJD301', { operation: 'insert' }, 'insert'));
  }

  protected updateRow(_key: K, _changes: Partial<T>, _options: WriteOptions<T>): Promise<Partial<T> | void> {
    return Promise.reject(DataError.create('MJD301', { operation: 'update' }, 'update'));
  }

  protected removeRow(_key: K, _options: WriteOptions<T>): Promise<void> {
    return Promise.reject(DataError.create('MJD301', { operation: 'remove' }, 'remove'));
  }

  /** For backends that take many changes in one request (OData `$batch`, a SOAP call). */
  protected saveBatch?(changes: readonly Change<T, K>[], options: OperationOptions): Promise<BatchResult<T>[]>;

  protected applyPushedChanges(_changes: readonly PushedChange<T, K>[]): void {}

  /** How memory reads, compares and sorts this adapter's rows. */
  get evaluateContext(): EvaluateContext {
    // Memory only sorts this adapter's rows, so the row type holds.
    const { sortValue, filterValue, compare } = this.memoryRules;
    return { fields: this.fields, locale: this.locale, sortValue: sortValue as EvaluateContext['sortValue'], filterValue: filterValue as EvaluateContext['filterValue'], compare };
  }

  private async query(options: LoadOptions, op: DataOperation): Promise<LoadResult<T>> {
    this.throwIfAborted(options.signal, op);
    const { remote, local } = splitLoad(options, this.capabilities);
    const result = await this.loadRows(remote);
    this.throwIfAborted(options.signal, op);
    if (!result || !Array.isArray(result.rows)) throw DataError.create('MJD104', { operation: op, details: result }, 'no rows');
    if (remote.count && !Number.isFinite(Number(result.total))) throw DataError.create('MJD104', { operation: op, details: result }, 'no total row count');

    const done = queryArray(result.rows, local, this.evaluateContext);
    const out: LoadResult<T> = { rows: done.rows };
    if (remote.count) out.total = Number(result.total);
    else if (local.count) out.total = done.total;
    const groups = local.group ? done.groups : result.groups;
    if (groups) out.groups = options.groupsOnly ? countsOnly(groups) : groups;
    if (options.groupsOnly) out.rows = [];
    const groupCount = local.group ? done.groupCount : result.groupCount;
    if (groupCount !== undefined) out.groupCount = groupCount;
    const summary = local.summary ? done.summary : result.summary;
    if (summary) out.summary = summary;
    return out;
  }

  private checkLoadOptions(o: LoadOptions, op: DataOperation): LoadOptions {
    const invalid = (detail: string) => DataError.create('MJD302', { operation: op }, detail);
    const out: LoadOptions = { ...o };
    for (const name of ['skip', 'take'] as const) {
      const value = o[name];
      if (value === undefined || value === null) {
        delete out[name];
      } else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw invalid(`${name} must be a number of 0 or more`);
      } else {
        out[name] = Math.floor(value);
      }
    }
    if (o.filter) {
      try {
        validateFilter(o.filter);
      } catch (e) {
        throw invalid((e as Error).message);
      }
    } else {
      delete out.filter;
    }
    if (o.sort) {
      if (o.sort.some((s) => !s || typeof s.field !== 'string' || (s.dir !== 'asc' && s.dir !== 'desc'))) {
        throw invalid('sort items are { field, dir: "asc" | "desc" }');
      }
      out.sort = o.sort.map((s) => ({ field: s.field, dir: s.dir }));
    }
    if (o.select) out.select = [...o.select];
    if (o.expand) out.expand = [...o.expand];
    if (o.group) {
      if (o.group.some((g) => !g || typeof g.field !== 'string' || (g.dir !== undefined && g.dir !== 'asc' && g.dir !== 'desc'))) {
        throw invalid('group items are { field, dir?: "asc" | "desc" }');
      }
      out.group = o.group.map((g) => ({ ...g }));
    }
    for (const name of ['summary', 'groupSummary'] as const) {
      const items = o[name];
      if (!items) continue;
      const bad = items.find((s) => !s || !SUMMARY_TYPES.has(s.type) || (s.type !== 'count' && typeof s.field !== 'string'));
      if (bad) throw invalid(`${name} items are { type: "count" | "sum" | "min" | "max" | "avg", field } (count needs no field)`);
      out[name] = items.map((s) => ({ ...s }));
    }
    return out;
  }

  private runBeforeEvent(change: Change<T, K>): Change<T, K> {
    if (change.type === 'insert') {
      this.requireCapability('insert', 'save');
      const e = { cancel: false, values: change.data };
      this.insertingEmitter.fire(e);
      this.throwIfCancelled(e, 'save');
      return { type: 'insert', data: e.values };
    }
    this.requireCapability(change.type, 'save');
    this.requireKey('save');
    if (change.type === 'update') {
      const e = { cancel: false, key: change.key, changes: change.data };
      this.updatingEmitter.fire(e);
      this.throwIfCancelled(e, 'save');
      return { ...change, data: e.changes };
    }
    const e = { cancel: false, key: change.key };
    this.removingEmitter.fire(e);
    this.throwIfCancelled(e, 'save');
    return change;
  }

  private sendChange(change: Change<T, K>, options: OperationOptions): Promise<Partial<T> | void> {
    if (change.type === 'insert') return this.insertRow(change.data, options);
    if (change.type === 'update') return this.updateRow(change.key, change.data, { ...options, original: change.original });
    return this.removeRow(change.key, { ...options, original: change.original });
  }

  private successOutcome(original: Change<T, K>, sent: Change<T, K>, returned: Partial<T> | void | undefined): SaveOutcome<T, K> {
    if (sent.type === 'insert') {
      const row = savedRow(sent.data, returned) as T;
      const key = this.keyOfSaved(row);
      this.insertedEmitter.fire({ values: sent.data, key, row });
      return { change: original, ok: true, key, row };
    }
    if (sent.type === 'update') {
      const row = savedChanges(sent.data, returned);
      this.updatedEmitter.fire({ key: sent.key, changes: sent.data, row });
      return { change: original, ok: true, key: sent.key, row };
    }
    this.removedEmitter.fire({ key: sent.key });
    return { change: original, ok: true, key: sent.key };
  }

  private keyOfSaved(row: T): K {
    return (this.keys.isSet ? this.keys.keyOf(row) : undefined) as K;
  }

  // Cancellations are not reported through onError.
  private reportFailure(error: unknown, op: DataOperation): DataError {
    const e = DataError.from(error, op);
    if (e.kind !== 'abort') this.errorEmitter.fire({ error: e });
    return e;
  }

  private throwIfAborted(signal: AbortSignal | undefined, op: DataOperation) {
    if (signal?.aborted) throw DataError.create('MJD105', { operation: op });
  }

  private throwIfCancelled(e: EventArgs, op: DataOperation) {
    if (e.cancel) throw DataError.create('MJD106', { operation: op });
  }

  private requireCapability(what: 'insert' | 'update' | 'remove', op: DataOperation) {
    if (!this.capabilities[what]) throw DataError.create('MJD301', { operation: op }, what);
  }

  private requireKey(op: DataOperation) {
    if (!this.keys.isSet) throw DataError.create('MJD303', { operation: op });
  }
}

// A backend that sends the rows of the groups anyway: only the groups and their counts stay.
function countsOnly<T>(groups: readonly RowGroup<T>[]): RowGroup<T>[] {
  return groups.map(({ items: _items, groups: below, ...group }) => (below ? { ...group, groups: countsOnly(below) } : group));
}

// A returned object holding every sent field is the saved row itself;
// a smaller one, like just the new id, is written onto the given row.
function savedRow<T>(sent: Partial<T>, returned: Partial<T> | void | undefined): Partial<T> {
  if (!returned || typeof returned !== 'object') return sent;
  return holdsAll(sent, returned) ? returned : Object.assign(sent, returned);
}

// Changed fields are no row: a smaller answer is merged with them into a new object.
function savedChanges<T>(sent: Partial<T>, returned: Partial<T> | void | undefined): Partial<T> {
  if (!returned || typeof returned !== 'object') return sent;
  return holdsAll(sent, returned) ? returned : { ...sent, ...returned };
}

function holdsAll(sent: object, returned: object): boolean {
  return Object.keys(sent).every((k) => k in returned);
}
