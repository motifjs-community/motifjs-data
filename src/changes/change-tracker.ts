import { Disposable, DisposableStore, Emitter, type Event as MotifEvent } from '@motifx/core';
import type { Change } from '../adapter/change';
import type { SaveOutcome } from '../adapter/save-outcome';
import { DataError } from '../errors/data-error';
import { getField, isEmpty, toDate } from '../query/values';
import type { DataSource } from '../source/data-source';
import type { ChangeTrackerChange } from './change-tracker-change';
import type { ChangeTrackerOptions } from './change-tracker-options';
import type { ChangeTrackerSavedEventArgs } from './change-tracker-saved-event-args';
import type { ChangeTrackerSavingEventArgs } from './change-tracker-saving-event-args';
import type { RowCheckContext } from './row-check-context';
import type { RowEdit } from './row-edit';
import type { RowEditState } from './row-edit-state';
import type { RowStatus } from './row-status';
import type { SaveMode } from './save-mode';

type SaveKind = 'insert' | 'update' | 'remove';

const SAVE_ORDER: readonly SaveKind[] = ['remove', 'update', 'insert'];

/**
 * Unsaved edits, new rows and deletions over a `DataSource`, saved through its adapter. Edits are kept
 * by row key, not by position, so they survive paging, sorting and scrolling; the row object changes
 * only when the row is saved. The save mode decides when rows are sent (see `SaveMode`).
 */
export class ChangeTracker<T = Record<string, unknown>, K = unknown> extends Disposable {
  readonly source: DataSource<T, K>;
  readonly saveMode: SaveMode;
  private readonly options: ChangeTrackerOptions<T, K>;
  private readonly disposables = new DisposableStore();
  private readonly changedEmitter = this.disposables.add(new Emitter<ChangeTrackerChange<T>>());
  private readonly savingEmitter = this.disposables.add(new Emitter<ChangeTrackerSavingEventArgs<T, K>>());
  private readonly savedEmitter = this.disposables.add(new Emitter<ChangeTrackerSavedEventArgs<T, K>>());
  private readonly records = new Map<string, RowEdit<T>>();
  /** Ids of new rows, which have no key until they are saved. */
  private readonly newIds = new WeakMap<object, string>();
  private added: T[] = [];
  private newRowCount = 0;
  /** Groups of row ids; each group is sent as one save. */
  private queue: string[][] = [];
  private sendingQueue = false;
  private disposed = false;

  /** The row the user is in. A message in it does not count as failed yet, and `background` does not send it. */
  currentRow: T | null = null;

  readonly onChanged: MotifEvent<ChangeTrackerChange<T>> = this.changedEmitter.event;
  /** Rows are about to be sent: change what goes out, keep a row back (`skip`), or `cancel`. */
  readonly onSaving: MotifEvent<ChangeTrackerSavingEventArgs<T, K>> = this.savingEmitter.event;
  /** The answer to a save came, with the outcome of each change. */
  readonly onSaved: MotifEvent<ChangeTrackerSavedEventArgs<T, K>> = this.savedEmitter.event;

  constructor(options: ChangeTrackerOptions<T, K>) {
    super();
    if (!options.source.adapter.keys.isSet) throw DataError.create('MJD303', { operation: 'save' });
    this.options = options;
    this.source = options.source;
    this.saveMode = options.saveMode ?? 'wait';
    const keepSaved = !!options.keepSavedNewRows;
    this.disposables.add(
      this.source.onChanged((e) => {
        if (e.reason === (keepSaved ? 'reload' : 'query')) this.releaseSaved();
        else if (!keepSaved && (e.reason === 'loaded' || e.reason === 'rows')) this.releaseLoaded();
      }),
    );
  }

  /**
   * Rows added here: unsaved ones, and saved ones until the source has them among its rows or a new
   * query starts (with `keepSavedNewRows`, until the source's `reload()`).
   */
  get newRows(): readonly T[] {
    return this.added;
  }

  /** Rows with something to save. */
  get pendingCount(): number {
    return this.count((rec) => this.pendingKind(rec) !== null && !this.isUntouchedRecord(rec));
  }

  get failedCount(): number {
    return this.count((rec) => rec.failed || (isInvalid(rec) && rec.row !== this.currentRow));
  }

  get savingCount(): number {
    return this.count((rec) => rec.saving);
  }

  get hasChanges(): boolean {
    return this.pendingCount > 0;
  }

  /** The id edits are kept under: the key as text, or `+1`, `+2` … for a new row. */
  rowIdOf(row: T): string {
    return this.newIds.get(row as object) ?? this.source.adapter.keyString(this.source.adapter.keyOf(row));
  }

  /** What the tracker holds for the row, or `undefined` when the row has nothing (no edit, mark, message or save). */
  editOf(row: T): RowEditState<T> | undefined {
    return this.records.get(this.rowIdOf(row));
  }

  /** `editOf` by the id from `rowIdOf`. */
  editById(rowId: string): RowEditState<T> | undefined {
    return this.records.get(rowId);
  }

  /** The value to show: the unsaved one when there is one. */
  getValue(row: T, field: string): unknown {
    const rec = this.records.get(this.rowIdOf(row));
    return rec ? this.valueIn(rec, field) : getField(row, field);
  }

  /** Whether the field (or, without a field, the row) has something to save. */
  isChanged(row: T, field?: string): boolean {
    const rec = this.records.get(this.rowIdOf(row));
    if (!rec) return false;
    return field === undefined ? this.pendingKind(rec) !== null : Object.hasOwn(rec.draft, field);
  }

  statusOf(row: T): RowStatus {
    const rec = this.records.get(this.rowIdOf(row));
    if (!rec) return '';
    if (rec.saving) return 'saving';
    if (rec.failed) return 'failed';
    if (rec.removed) return 'removed';
    if (isInvalid(rec)) return 'invalid';
    if (rec.isNew) return 'new';
    return hasKeys(rec.draft) ? 'changed' : '';
  }

  /** Messages by field; `''` is the message of the whole row. */
  errorsOf(row: T): Readonly<Record<string, string>> {
    return this.records.get(this.rowIdOf(row))?.errors ?? {};
  }

  errorOf(row: T, field: string): string {
    return this.errorsOf(row)[field] ?? '';
  }

  /** The message of the whole row, or the first field message. */
  messageOf(row: T): string {
    const errors = this.errorsOf(row);
    return errors[''] || Object.values(errors).find(Boolean) || '';
  }

  /** Rows with something to save, in the order they are saved. */
  pendingRows(): T[] {
    return this.pendingRecords().map(({ rec }) => rec.row);
  }

  /** Rows with a failed save or a message. */
  failedRows(): T[] {
    return [...this.records.values()].filter((rec) => rec.failed || isInvalid(rec)).map((rec) => rec.row);
  }

  /** Adds a new row at `position` of `newRows` (default: the end). `values` count as entered. */
  add(values?: Partial<T>, position = this.added.length): T {
    const row = { ...(this.options.createRow?.() ?? {}) } as T;
    const rowId = `+${++this.newRowCount}`;
    this.newIds.set(row as object, rowId);
    this.added.splice(Math.max(0, Math.min(this.added.length, position)), 0, row);
    const rec = this.recordFor(rowId, row, true);
    for (const [field, value] of Object.entries(values ?? {})) if (value !== undefined) rec.draft[field] = value;
    this.fire('added', [row]);
    return row;
  }

  /** A new row nothing was entered in; leaving it (`commit`) drops it. */
  isUntouched(row: T): boolean {
    const rec = this.records.get(this.rowIdOf(row));
    return !!rec && this.isUntouchedRecord(rec);
  }

  /** Writes an entered value; the value the row already has is no change. The field is checked at once. */
  setValue(row: T, field: string, value: unknown) {
    const rec = this.recordFor(this.rowIdOf(row), row, false);
    if (this.same(value, getField(rec.row, field), field)) delete rec.draft[field];
    else rec.draft[field] = value ?? null;
    const errors = { ...rec.errors };
    delete errors[field];
    const message = this.options.validateField?.(field, this.valueIn(rec, field), { ...this.checkContext(rec), row: rec.row });
    if (message) errors[field] = message;
    rec.errors = errors;
    this.dropIfEmpty(rec);
    this.fire('edited', [row]);
  }

  /** A message on a field, e.g. from an editor that cannot read the text. */
  setError(row: T, field: string, message: string) {
    const rec = this.recordFor(this.rowIdOf(row), row, false);
    rec.errors = { ...rec.errors, [field]: message };
    this.fire('edited', [row]);
  }

  /** Checks the row before it is saved. Returns the first field with a message (`''`: the whole row), or `null`. */
  validate(row: T): string | null {
    const rec = this.records.get(this.rowIdOf(row));
    if (!rec || rec.removed) return null;
    const context = this.checkContext(rec);
    const changed = Object.keys(rec.draft);
    const errors: Record<string, string> = {};
    for (const field of changed) {
      const message = this.options.validateField?.(field, rec.draft[field], { ...context, row: rec.row });
      if (message) errors[field] = message;
    }
    const whole = this.options.validateRow?.(rec.row, { ...context, changed });
    if (typeof whole === 'string' && whole) errors[''] = whole;
    else if (whole && typeof whole === 'object') {
      for (const [field, message] of Object.entries(whole)) if (message) errors[field] ??= message;
    }
    rec.errors = errors;
    this.fire('edited', [row]);
    return isInvalid(rec) ? (Object.keys(errors).find((f) => f !== '') ?? '') : null;
  }

  /**
   * The user left the row: it is checked and sent as the save mode says. `false` when it has a message;
   * in `'wait'`, a promise of whether it was saved. An untouched new row is dropped.
   */
  commit(row: T): boolean | Promise<boolean> {
    const rowId = this.rowIdOf(row);
    const rec = this.records.get(rowId);
    if (!rec) return true;
    if (this.isUntouchedRecord(rec)) {
      this.discard(row);
      return true;
    }
    const kind = this.pendingKind(rec);
    if (!kind) return true;
    if (kind !== 'remove' && this.validate(row) !== null) return false;
    if (this.saveMode === 'batch') return true;
    if (this.saveMode === 'background') {
      this.enqueue([rowId]);
      return true;
    }
    return this.send([rec]).then((result) => {
      const after = this.records.get(rowId);
      return !result.skipped && (!after || (!after.failed && !isInvalid(after)));
    });
  }

  /** Deletes a row as the save mode says: `'batch'` marks it, the others send it. A new row is dropped. */
  remove(row: T): Promise<boolean> {
    return this.removeRows([row]);
  }

  /**
   * Deletes several rows in one save: `'batch'` marks them, `'wait'` and `'background'` send them together
   * (one request when the adapter saves in batches, else one per row). New rows are dropped. Resolves to
   * whether every row was deleted (in `'batch'` and `'background'`, marked or queued).
   */
  async removeRows(rows: readonly T[]): Promise<boolean> {
    const marked: RowEdit<T>[] = [];
    let all = true;
    for (const row of new Set(rows)) {
      const rec = this.recordFor(this.rowIdOf(row), row, false);
      if (rec.saving) {
        all = false;
        continue;
      }
      if (rec.isNew) {
        this.discard(row);
        continue;
      }
      rec.removed = true;
      rec.failed = false;
      rec.errors = {};
      marked.push(rec);
    }
    if (!marked.length) return all;
    this.fire('edited', marked.map((rec) => rec.row));
    if (this.saveMode === 'batch') return all;
    if (this.saveMode === 'background') {
      this.enqueue(marked.map((rec) => rec.rowId));
      return all;
    }
    const result = await this.send(marked);
    return all && !result.skipped && marked.every((rec) => !this.records.has(rec.rowId));
  }

  /** `removeRows` by key; a key with no row (loaded, found before or from the adapter) counts as not deleted. */
  async removeKeys(keys: readonly K[]): Promise<boolean> {
    const rows = await Promise.all(keys.map((key) => this.source.byKey(key).catch(() => undefined)));
    const found = rows.filter((row) => row !== undefined) as T[];
    const removed = await this.removeRows(found);
    return removed && found.length === keys.length;
  }

  /** Takes a deletion mark back. */
  restore(row: T) {
    const rec = this.records.get(this.rowIdOf(row));
    if (!rec || rec.saving || !rec.removed) return;
    rec.removed = false;
    rec.failed = false;
    rec.errors = {};
    this.dropIfEmpty(rec);
    this.fire('edited', [row]);
  }

  /** Drops the edits of a row; a new row is dropped altogether. */
  discard(row: T) {
    const rec = this.records.get(this.rowIdOf(row));
    if (!rec || rec.saving) return;
    if (rec.isNew) {
      this.records.delete(rec.rowId);
      this.removeAdded(rec.row);
      this.fire('dropped', [rec.row]);
      return;
    }
    rec.draft = {};
    rec.removed = false;
    rec.failed = false;
    rec.errors = {};
    this.dropIfEmpty(rec);
    this.fire('edited', [row]);
  }

  /** Drops every unsaved change; rows being saved stay. */
  discardChanges() {
    for (const rec of [...this.records.values()]) this.discard(rec.row);
  }

  /** The unsaved changes, in the order they are saved: deletions, updates, new rows. */
  changes(): Change<T, K>[] {
    return this.pendingRecords().map(({ rec, kind }) => this.changeOf(rec, kind));
  }

  /** Saves every unsaved change at once. Rows with a message are not sent and count as failed. */
  async saveChanges(): Promise<{ saved: number; failed: number }> {
    let failed = 0;
    const toSend: RowEdit<T>[] = [];
    for (const { rec, kind } of this.pendingRecords()) {
      if (kind !== 'remove' && this.validate(rec.row) !== null) failed++;
      else toSend.push(rec);
    }
    const result = toSend.length ? await this.send(toSend) : { saved: 0, failed: 0, skipped: 0 };
    return { saved: result.saved, failed: failed + result.failed };
  }

  /** Takes saved new rows out of `newRows`, whether the source has them yet or not. */
  releaseSaved() {
    this.release(this.added.filter((row) => !this.records.has(this.rowIdOf(row))));
  }

  override dispose() {
    this.disposed = true;
    this.queue = [];
    this.disposables.dispose();
    super.dispose();
  }

  private pendingRecords(): { rec: RowEdit<T>; kind: SaveKind }[] {
    const pending: { rec: RowEdit<T>; kind: SaveKind }[] = [];
    for (const rec of this.records.values()) {
      const kind = this.pendingKind(rec);
      if (kind && !rec.saving && !this.isUntouchedRecord(rec)) pending.push({ rec, kind });
    }
    const order = this.options.saveOrder ?? SAVE_ORDER;
    const rank = (kind: SaveKind) => {
      const at = order.indexOf(kind);
      return at < 0 ? order.length + SAVE_ORDER.indexOf(kind) : at;
    };
    return pending.sort((a, b) => rank(a.kind) - rank(b.kind));
  }

  private pendingKind(rec: RowEdit<T>): SaveKind | null {
    if (rec.removed) return rec.isNew ? null : 'remove';
    if (rec.isNew) return 'insert';
    return hasKeys(rec.draft) ? 'update' : null;
  }

  private isUntouchedRecord(rec: RowEdit<T>): boolean {
    return rec.isNew && !rec.saving && !rec.removed && !rec.failed && !hasKeys(rec.draft);
  }

  private recordFor(rowId: string, row: T, isNew: boolean): RowEdit<T> {
    let rec = this.records.get(rowId);
    if (!rec) {
      rec = { rowId, row, isNew, draft: {}, errors: {}, saving: false, removed: false, failed: false };
      this.records.set(rowId, rec);
    }
    return rec;
  }

  private valueIn(rec: RowEdit<T>, field: string): unknown {
    return Object.hasOwn(rec.draft, field) ? rec.draft[field] : getField(rec.row, field);
  }

  private checkContext(rec: RowEdit<T>): RowCheckContext<T> {
    return { values: rec.draft as Partial<T>, isNew: rec.isNew, getValue: (field) => this.valueIn(rec, field) };
  }

  // A new row goes out as the values to save; `send` writes them onto the row and sends the row itself.
  private changeOf(rec: RowEdit<T>, kind: SaveKind): Change<T, K> {
    if (kind === 'insert') return { type: 'insert', data: { ...(rec.row as object), ...rec.draft } as Partial<T> };
    const key = this.source.adapter.keyOf(rec.row);
    return kind === 'update' ? { type: 'update', key, data: { ...rec.draft } as Partial<T>, original: rec.row } : { type: 'remove', key, original: rec.row };
  }

  private dropIfEmpty(rec: RowEdit<T>) {
    if (!rec.isNew && !rec.saving && !rec.removed && !rec.failed && !isInvalid(rec) && !hasKeys(rec.draft)) this.records.delete(rec.rowId);
  }

  private enqueue(rowIds: string[]) {
    const queued = new Set(this.queue.flat());
    const fresh = rowIds.filter((id) => !queued.has(id));
    if (fresh.length) this.queue.push(fresh);
    void this.sendQueue();
  }

  private async sendQueue() {
    if (this.sendingQueue) return;
    this.sendingQueue = true;
    try {
      while (this.queue.length && !this.disposed) {
        const recs = this.queue.shift()!.map((id) => this.records.get(id)).filter((rec) => !!rec && !rec.saving && !!this.pendingKind(rec)) as RowEdit<T>[];
        if (recs.length) await this.send(recs);
      }
    } finally {
      this.sendingQueue = false;
    }
  }

  // Sends the rows through the adapter and applies each outcome to its row; `onSaving` may keep some back.
  private async send(all: RowEdit<T>[]): Promise<{ saved: number; failed: number; skipped: number }> {
    const allKinds = all.map((rec) => this.pendingKind(rec)!);
    const allChanges = all.map((rec, i) => this.changeOf(rec, allKinds[i]));
    const skipped = new Set<T>();
    const e: ChangeTrackerSavingEventArgs<T, K> = {
      cancel: false,
      changes: allChanges,
      rows: all.map((rec) => rec.row),
      skip: (row) => void skipped.add(row),
    };
    this.savingEmitter.fire(e);
    if (e.cancel) return { saved: 0, failed: 0, skipped: all.length };
    const keep = all.map((rec) => !skipped.has(rec.row));
    const recs = all.filter((_, i) => keep[i]);
    const kinds = allKinds.filter((_, i) => keep[i]);
    const changes = allChanges.filter((_, i) => keep[i]).map((change, i) => (change.type === 'insert' ? this.ownRow(recs[i].row, change.data) : change));
    if (!recs.length) return { saved: 0, failed: 0, skipped: all.length };
    const sentDrafts = recs.map((rec) => ({ ...rec.draft }));
    for (const rec of recs) {
      rec.saving = true;
      rec.failed = false;
      rec.errors = {};
    }
    this.fire('saving', recs.map((rec) => rec.row));

    let outcomes: SaveOutcome<T, K>[];
    try {
      outcomes = await this.source.adapter.save(changes);
    } catch (error) {
      outcomes = changes.map((change) => ({ change, ok: false, error: DataError.from(error, 'save') }));
    }
    if (this.disposed) return { saved: 0, failed: 0, skipped: 0 };

    const saved: T[] = [];
    const failed: T[] = [];
    recs.forEach((rec, i) => {
      if (this.records.get(rec.rowId) !== rec) return;
      rec.saving = false;
      const outcome = outcomes[i];
      if (!outcome.ok) {
        rec.failed = true;
        if (kinds[i] === 'remove' && this.saveMode !== 'batch') rec.removed = false;
        rec.errors = { ...(outcome.error.fields ?? {}), '': outcome.error.plainMessage };
        failed.push(rec.row);
        return;
      }
      saved.push(rec.row);
      if (kinds[i] === 'remove') {
        this.records.delete(rec.rowId);
        return;
      }
      if (outcome.row && outcome.row !== rec.row) Object.assign(rec.row as object, outcome.row);
      // A value entered again while the row was being saved stays to be saved.
      for (const [field, value] of Object.entries(sentDrafts[i])) if (this.same(rec.draft[field], value, field)) delete rec.draft[field];
      rec.isNew = false;
      this.dropIfEmpty(rec);
      if (this.saveMode === 'background' && this.records.has(rec.rowId) && this.pendingKind(rec) && rec.row !== this.currentRow) this.enqueue([rec.rowId]);
    });
    if (saved.length) this.fire('saved', saved);
    if (failed.length) this.fire('failed', failed);
    this.savedEmitter.fire({ changes, rows: recs.map((rec) => rec.row), outcomes });
    if (!this.options.keepSavedNewRows) this.releaseLoaded();
    return { saved: saved.length, failed: failed.length, skipped: all.length - recs.length };
  }

  // The new row itself is saved, so the backend that keeps objects keeps this one.
  private ownRow(row: T, values: Partial<T>): Change<T, K> {
    Object.assign(row as object, values);
    return { type: 'insert', data: row as Partial<T> };
  }

  // A saved new row leaves `newRows` once the source has it among its rows.
  private releaseLoaded() {
    const loaded = this.added.filter((row) => {
      if (this.records.has(this.rowIdOf(row)) || !this.source.adapter.keys.hasKey(row)) return false;
      return this.source.indexOfKey(this.source.adapter.keyOf(row)) >= 0;
    });
    this.release(loaded);
  }

  private release(rows: T[]) {
    if (!rows.length) return;
    for (const row of rows) this.removeAdded(row);
    this.fire('released', rows);
  }

  private removeAdded(row: T) {
    const at = this.added.indexOf(row);
    if (at >= 0) this.added.splice(at, 1);
  }

  private same(a: unknown, b: unknown, field: string): boolean {
    return this.options.sameValue ? this.options.sameValue(a, b, field) : sameValue(a, b);
  }

  private count(test: (rec: RowEdit<T>) => boolean): number {
    let n = 0;
    for (const rec of this.records.values()) if (test(rec)) n++;
    return n;
  }

  private fire(reason: ChangeTrackerChange<T>['reason'], rows: readonly T[]) {
    this.changedEmitter.fire({ reason, rows });
  }
}

function hasKeys(o: object): boolean {
  return Object.keys(o).length > 0;
}

function isInvalid(rec: RowEdit<unknown>): boolean {
  return hasKeys(rec.errors);
}

/** Empty values are the same; dates by moment. */
function sameValue(a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (a instanceof Date || b instanceof Date) return toDate(a)?.getTime() === toDate(b)?.getTime();
  return Object.is(a, b);
}
