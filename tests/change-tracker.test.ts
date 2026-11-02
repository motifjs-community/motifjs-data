import { reactive } from '@motifx/core';
import { describe, expect, it, vi } from 'vitest';
import { data } from '../src';
const { ArrayAdapter, ChangeTracker, DataError, DataSource, where } = data;

type Order = { id: number; customer: string; amount: number };

/** Orders in memory; logs every write with the original it got, can pause writes and rejects negative amounts. */
class OrderAdapter extends ArrayAdapter<Order, number> {
  readonly writes: string[] = [];
  paused = false;
  private waiting: (() => void)[] = [];

  constructor() {
    const rows: Order[] = [
      { id: 1, customer: 'Ada', amount: 10 },
      { id: 2, customer: 'Grace', amount: 20 },
      { id: 3, customer: 'İsmail', amount: 30 },
    ];
    super({ data: rows, key: 'id', createKey: (_, all) => Math.max(...all.map((r) => r.id)) + 1 });
  }

  resume() {
    this.paused = false;
    this.waiting.splice(0).forEach((go) => go());
  }

  protected override async insertRow(values: Partial<Order>) {
    await this.wait(`insert ${values.customer}`);
    return super.insertRow(values);
  }

  protected override async updateRow(key: number, changes: Partial<Order>, options: data.WriteOptions<Order> = {}) {
    await this.wait(`update ${key} ${JSON.stringify(changes)} from ${options.original?.amount}`);
    if ((changes.amount ?? 0) < 0) throw DataError.create('MJD202', { operation: 'update', fields: { amount: 'Must not be negative' } }, 'Check the values');
    return super.updateRow(key, changes);
  }

  protected override async removeRow(key: number, options: data.WriteOptions<Order> = {}) {
    await this.wait(`remove ${key} from ${options.original?.customer}`);
    if (key === 99) throw DataError.create('MJD204', { operation: 'remove' });
    return super.removeRow(key);
  }

  private async wait(write: string) {
    this.writes.push(write);
    if (this.paused) await new Promise<void>((go) => this.waiting.push(go));
  }
}

/** Takes several changes in one call, the way OData `$batch`, a REST batch endpoint or a SOAP call does. */
class BatchOrderAdapter extends OrderAdapter {
  readonly batches: string[][] = [];

  protected override async saveBatch(changes: readonly data.Change<Order, number>[]): Promise<data.BatchResult<Order>[]> {
    this.batches.push(changes.map((change) => (change.type === 'insert' ? 'insert' : `${change.type} ${change.key}`)));
    const results: data.BatchResult<Order>[] = [];
    for (const change of changes) {
      try {
        if (change.type !== 'remove') throw new Error('only deletions here');
        await this.removeRow(change.key, { original: change.original });
        results.push({ ok: true });
      } catch (error) {
        results.push({ ok: false, error });
      }
    }
    return results;
  }
}

async function setup(saveMode: data.SaveMode, options: Partial<data.ChangeTrackerOptions<Order, number>> = {}, sourceOptions: Partial<data.DataSourceOptions<Order, number>> = {}) {
  const adapter = new OrderAdapter();
  const source = new DataSource<Order, number>({ adapter, loadMode: 'all', sort: [{ field: 'id', dir: 'asc' }], ...sourceOptions });
  await source.load();
  const tracker = new ChangeTracker<Order, number>({ source, saveMode, ...options });
  const reasons: string[] = [];
  tracker.onChanged((e) => reasons.push(e.reason));
  return { adapter, source, tracker, reasons, row: (id: number) => source.rowByKey(id)! };
}

describe('ChangeTracker', () => {
  it('keeps entered values apart from the row until it is saved', async () => {
    const { adapter, tracker, row, source } = await setup('wait');
    const ada = row(1);
    tracker.setValue(ada, 'amount', 15);
    expect([ada.amount, tracker.getValue(ada, 'amount'), tracker.statusOf(ada), tracker.isChanged(ada, 'amount'), tracker.pendingCount]).toEqual([10, 15, 'changed', true, 1]);

    tracker.setValue(ada, 'amount', 10);
    expect([tracker.statusOf(ada), tracker.pendingCount]).toEqual(['', 0]);

    tracker.setValue(ada, 'amount', 15);
    expect(await tracker.commit(ada)).toBe(true);
    expect(adapter.writes).toEqual(['update 1 {"amount":15} from 10']);
    expect([ada.amount, tracker.statusOf(ada), tracker.hasChanges]).toEqual([15, '', false]);
    expect(source.rowByKey(1)).toBe(ada);
  });

  it('checks values as they are entered and before the row is saved', async () => {
    const { adapter, tracker, row } = await setup('wait', {
      validateField: (field, value) => (field === 'amount' && Number(value) > 1000 ? 'Too big' : null),
      validateRow: (_order, { isNew, getValue }) => (isNew && !getValue('customer') ? { customer: 'Customer is required' } : null),
    });
    const ada = row(1);
    tracker.setValue(ada, 'amount', 5000);
    expect([tracker.statusOf(ada), tracker.errorOf(ada, 'amount')]).toEqual(['invalid', 'Too big']);
    expect(tracker.commit(ada)).toBe(false);

    const added = tracker.add({ amount: 1 });
    expect(tracker.commit(added)).toBe(false);
    expect(tracker.errorsOf(added)).toEqual({ customer: 'Customer is required' });
    expect(adapter.writes).toEqual([]);
    tracker.currentRow = added;
    expect(tracker.failedCount).toBe(1);
  });

  it('gives the checks the row itself and the entered values apart', async () => {
    const seen: unknown[] = [];
    const rows: unknown[] = [];
    const { tracker, row } = await setup('batch', {
      validateField: (field, value, { row: checked, values, getValue, isNew }) => {
        rows.push(checked);
        seen.push([field, value, checked.customer, values.customer, getValue('customer'), isNew]);
        return null;
      },
      validateRow: (checked, { values, changed }) => {
        rows.push(checked);
        seen.push(['row', checked.amount, values.amount, changed]);
        return null;
      },
    });
    const ada = row(1);
    tracker.setValue(ada, 'amount', 11);
    tracker.validate(ada);
    const added = tracker.add();
    tracker.setValue(added, 'customer', 'Hopper');
    expect(seen).toEqual([
      ['amount', 11, 'Ada', undefined, 'Ada', false],
      ['amount', 11, 'Ada', undefined, 'Ada', false],
      ['row', 10, 11, ['amount']],
      ['customer', 'Hopper', undefined, 'Hopper', 'Hopper', true],
    ]);
    expect(rows).toEqual([ada, ada, ada, added]);
    expect(rows.every((r, i) => r === (i < 3 ? ada : added))).toBe(true);
  });

  it('hands out what it holds for a row, to read', async () => {
    const { tracker, row, adapter } = await setup('wait', { validateField: (field, value) => (field === 'amount' && Number(value) < 0 ? 'Negative' : null) });
    const ada = row(1);
    expect(tracker.editOf(ada)).toBeUndefined();
    tracker.setValue(ada, 'amount', -5);
    expect(tracker.editOf(ada)).toEqual({ rowId: tracker.rowIdOf(ada), row: ada, isNew: false, removed: false, saving: false, failed: false, draft: { amount: -5 }, errors: { amount: 'Negative' } });

    tracker.setValue(ada, 'amount', 15);
    adapter.paused = true;
    const saving = tracker.commit(ada);
    expect(tracker.editById(tracker.rowIdOf(ada))).toMatchObject({ saving: true, draft: { amount: 15 }, errors: {} });
    adapter.resume();
    await saving;
    expect(tracker.editOf(ada)).toBeUndefined();

    const added = tracker.add({ customer: 'Hopper' });
    expect(tracker.editById('+1')).toMatchObject({ row: added, isNew: true, draft: { customer: 'Hopper' } });
    await tracker.remove(row(2));
    expect(tracker.editOf(row(2))).toBeUndefined();
  });

  it('shows the messages of a failed save by field', async () => {
    const { tracker, row } = await setup('wait');
    const ada = row(1);
    tracker.setValue(ada, 'amount', -1);
    expect(await tracker.commit(ada)).toBe(false);
    expect(tracker.statusOf(ada)).toBe('failed');
    expect(tracker.errorsOf(ada)).toEqual({ amount: 'Must not be negative', '': 'Check the values' });
    expect([tracker.messageOf(ada), tracker.failedRows(), ada.amount]).toEqual(['Check the values', [ada], 10]);
  });

  it('adds new rows; a saved one leaves newRows when the source has it', async () => {
    const { tracker, source, reasons } = await setup('wait', { createRow: () => ({ amount: 0 }) });
    const untouched = tracker.add();
    expect([tracker.newRows, tracker.statusOf(untouched), tracker.pendingCount]).toEqual([[untouched], 'new', 0]);
    expect(tracker.commit(untouched)).toBe(true);
    expect(tracker.newRows).toEqual([]);
    expect(reasons).toEqual(['added', 'dropped']);

    const added = tracker.add({ customer: 'Hopper' });
    expect(tracker.rowIdOf(added)).toBe('+2');
    expect(await tracker.commit(added)).toBe(true);
    expect(added).toMatchObject({ id: 4, customer: 'Hopper', amount: 0 });
    expect(source.rows.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(tracker.newRows).toEqual([]);
    expect(reasons.slice(2)).toEqual(['added', 'edited', 'saving', 'saved', 'released']);
  });

  it('keeps a saved new row in newRows until a page of the source brings it', async () => {
    const { tracker, source } = await setup('wait', {}, { loadMode: 'page', pageSize: 2, sort: [{ field: 'id', dir: 'desc' }] });
    const added = tracker.add({ customer: 'Hopper', amount: 1 });
    await tracker.commit(added);
    expect([tracker.newRows, source.total]).toEqual([[added], 4]);
    await source.reload();
    expect(source.rows.map((r) => r.id)).toEqual([4, 3]);
    expect(tracker.newRows).toEqual([]);
  });

  it('lets saved new rows go when a new query starts', async () => {
    const { tracker, source } = await setup('wait', {}, { loadMode: 'page', pageSize: 2 });
    const added = tracker.add({ customer: 'Hopper', amount: 1 });
    await tracker.commit(added);
    expect(tracker.newRows).toEqual([added]);
    await source.setFilter(where('amount', '>', 5));
    expect(tracker.newRows).toEqual([]);
  });

  it('keeps saved new rows in newRows until the source reloads, with keepSavedNewRows', async () => {
    const { tracker, source, reasons } = await setup('wait', { keepSavedNewRows: true });
    const added = tracker.add({ customer: 'Hopper', amount: 1 });
    await tracker.commit(added);
    expect([source.rows.map((r) => r.id), tracker.newRows, tracker.editOf(added)]).toEqual([[1, 2, 3, 4], [added], undefined]);
    await source.setSort([{ field: 'id', dir: 'desc' }]);
    expect(tracker.newRows).toEqual([added]);
    await source.reload();
    expect([tracker.newRows, reasons.at(-1)]).toEqual([[], 'released']);
  });

  it('sends rows in the background one at a time, in the order they were left', async () => {
    const { adapter, tracker, row } = await setup('background');
    adapter.paused = true;
    const [ada, grace] = [row(1), row(2)];
    tracker.setValue(ada, 'amount', 11);
    tracker.setValue(grace, 'amount', 21);
    expect(tracker.commit(ada)).toBe(true);
    expect(tracker.commit(grace)).toBe(true);
    expect([tracker.statusOf(ada), tracker.statusOf(grace), adapter.writes.length]).toEqual(['saving', 'changed', 1]);

    // Changed again while it is being saved: sent again after.
    tracker.setValue(ada, 'amount', 12);
    adapter.resume();
    await vi.waitFor(() => expect(tracker.hasChanges).toBe(false));
    expect(adapter.writes).toEqual(['update 1 {"amount":11} from 10', 'update 2 {"amount":21} from 20', 'update 1 {"amount":12} from 11']);
    expect([ada.amount, grace.amount]).toEqual([12, 21]);
  });

  it('saves everything at once in batch mode: deletions, updates, then new rows', async () => {
    const { adapter, tracker, row, source } = await setup('batch');
    const [ada, grace] = [row(1), row(2)];
    tracker.setValue(ada, 'amount', 11);
    expect(tracker.commit(ada)).toBe(true);
    await tracker.remove(grace);
    expect(tracker.statusOf(grace)).toBe('removed');
    tracker.restore(grace);
    expect(tracker.statusOf(grace)).toBe('');
    await tracker.remove(grace);
    tracker.add({ customer: 'Hopper', amount: 5 });
    expect(adapter.writes).toEqual([]);

    expect(tracker.changes()).toMatchObject([
      { type: 'remove', key: 2, original: { customer: 'Grace' } },
      { type: 'update', key: 1, data: { amount: 11 }, original: { amount: 10 } },
      { type: 'insert', data: { customer: 'Hopper', amount: 5 } },
    ]);
    expect(await tracker.saveChanges()).toEqual({ saved: 3, failed: 0 });
    expect(adapter.writes).toEqual(['remove 2 from Grace', 'update 1 {"amount":11} from 10', 'insert Hopper']);
    expect(source.rows.map((r) => r.customer)).toEqual(['Ada', 'İsmail', 'Hopper']);
    expect([tracker.hasChanges, tracker.newRows]).toEqual([false, []]);
  });

  it('does not send a row with a message, and counts it as failed', async () => {
    const { adapter, tracker, row } = await setup('batch', { validateField: (_, value) => (value === '' ? 'Required' : null) });
    tracker.setValue(row(1), 'customer', '');
    tracker.setValue(row(2), 'amount', 25);
    expect(await tracker.saveChanges()).toEqual({ saved: 1, failed: 1 });
    expect(adapter.writes).toEqual(['update 2 {"amount":25} from 20']);
    expect(tracker.statusOf(row(1))).toBe('invalid');
  });

  it('deletes at once in wait mode and keeps the row when the delete fails', async () => {
    const { tracker, row, source } = await setup('wait');
    expect(await tracker.remove(row(2))).toBe(true);
    expect(source.rows.map((r) => r.id)).toEqual([1, 3]);

    const missing = { id: 99, customer: 'Nobody', amount: 0 };
    expect(await tracker.remove(missing)).toBe(false);
    expect([tracker.statusOf(missing), tracker.messageOf(missing)]).toEqual(['failed', 'No row with this key.']);
  });

  it('deletes several rows in one save in wait mode, one request when the adapter takes batches', async () => {
    const adapter = new BatchOrderAdapter();
    const source = new DataSource<Order, number>({ adapter, loadMode: 'all', sort: [{ field: 'id', dir: 'asc' }] });
    await source.load();
    const tracker = new ChangeTracker<Order, number>({ source, saveMode: 'wait' });
    const saves: number[] = [];
    tracker.onSaving((e) => saves.push(e.changes.length));
    const added = tracker.add({ customer: 'Hopper' });

    expect(await tracker.removeRows([source.rowByKey(1)!, source.rowByKey(3)!, added])).toBe(true);
    expect([saves, adapter.batches, source.rows.map((r) => r.id), tracker.newRows]).toEqual([[2], [['remove 1', 'remove 3']], [2], []]);
  });

  it('sends one request per row when the adapter has no batch, and reports a failed one', async () => {
    const { adapter, tracker, row, source } = await setup('wait');
    const saves: number[] = [];
    tracker.onSaving((e) => saves.push(e.changes.length));
    const missing = { id: 99, customer: 'Nobody', amount: 0 };
    expect(await tracker.removeRows([row(1), missing])).toBe(false);
    expect([saves, adapter.writes]).toEqual([[2], ['remove 1 from Ada', 'remove 99 from Nobody']]);
    expect([source.rows.map((r) => r.id), tracker.statusOf(missing)]).toEqual([[2, 3], 'failed']);
  });

  it('sends several deletions as one save in the background', async () => {
    const { adapter, tracker, row, source } = await setup('background');
    const saves: number[] = [];
    tracker.onSaving((e) => saves.push(e.changes.length));
    expect(await tracker.removeRows([row(1), row(2)])).toBe(true);
    await vi.waitFor(() => expect(tracker.hasChanges).toBe(false));
    expect([saves, adapter.writes, source.rows.map((r) => r.id)]).toEqual([[2], ['remove 1 from Ada', 'remove 2 from Grace'], [3]]);
  });

  it('marks several deletions in batch mode, by row or by key', async () => {
    const { adapter, tracker, row } = await setup('batch');
    expect(await tracker.removeKeys([1, 3, 42])).toBe(false);
    expect([tracker.statusOf(row(1)), tracker.statusOf(row(2)), tracker.statusOf(row(3)), adapter.writes]).toEqual(['removed', '', 'removed', []]);
    expect(await tracker.removeRows([row(2)])).toBe(true);
    expect(await tracker.saveChanges()).toEqual({ saved: 3, failed: 0 });
  });

  it('drops every unsaved change', async () => {
    const { tracker, row } = await setup('batch');
    tracker.setValue(row(1), 'amount', 99);
    await tracker.remove(row(2));
    tracker.add({ customer: 'Hopper' });
    tracker.discardChanges();
    expect([tracker.hasChanges, tracker.newRows, tracker.getValue(row(1), 'amount'), tracker.statusOf(row(2))]).toEqual([false, [], 10, '']);
  });

  for (const kind of ['plain', 'reactive']) {
    it(`sends and keeps the given rows themselves, ${kind}`, async () => {
      const give = (o: Order) => (kind === 'reactive' ? reactive(o) : o);
      const rows = [give({ id: 1, customer: 'Ada', amount: 10 }), give({ id: 2, customer: 'Grace', amount: 20 })];
      const source = new DataSource<Order, number>({ adapter: new ArrayAdapter<Order, number>({ data: rows, key: 'id' }), loadMode: 'all' });
      await source.load();
      const tracker = new ChangeTracker<Order, number>({ source, saveMode: 'batch' });
      const [ada, grace] = rows;
      expect(source.rowByKey(1)).toBe(ada);
      expect(source.rowByKey(2)).toBe(grace);

      tracker.setValue(ada, 'amount', 11);
      await tracker.remove(grace);
      const [remove, update] = tracker.changes();
      expect(remove.type === 'remove' && remove.original).toBe(grace);
      expect(update.type === 'update' && update.original).toBe(ada);

      const saved = vi.fn();
      tracker.onSaved(saved);
      expect(await tracker.saveChanges()).toEqual({ saved: 2, failed: 0 });
      expect(saved.mock.calls[0][0].rows[0]).toBe(grace);
      expect(saved.mock.calls[0][0].rows[1]).toBe(ada);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toBe(ada);
      expect(ada.amount).toBe(11);
      expect(source.rowByKey(1)).toBe(ada);
    });
  }

  for (const kind of ['plain', 'reactive']) {
    it(`saves the new row itself into the array, ${kind}`, async () => {
      const rows: Order[] = kind === 'reactive' ? reactive([{ id: 1, customer: 'Ada', amount: 10 }]) : [{ id: 1, customer: 'Ada', amount: 10 }];
      const adapter = new ArrayAdapter<Order, number>({ data: rows, key: 'id', createKey: (_, all) => all.length + 1 });
      const source = new DataSource<Order, number>({ adapter, loadMode: 'all' });
      await source.load();
      const tracker = new ChangeTracker<Order, number>({ source, saveMode: 'wait', createRow: () => ({ amount: 0 }) });
      const inserting: unknown[] = [];
      tracker.onSaving((e) => inserting.push(e.rows[0], e.changes[0].type === 'insert' && e.changes[0].data));
      const saved = vi.fn();
      tracker.onSaved(saved);

      const added = tracker.add({ customer: 'Hopper' });
      tracker.setValue(added, 'amount', 5);
      expect(added.customer).toBeUndefined();
      expect(await tracker.commit(added)).toBe(true);
      expect(inserting[0]).toBe(added);
      expect(inserting[1]).toEqual({ amount: 5, customer: 'Hopper' });
      expect(saved.mock.calls[0][0].rows[0]).toBe(added);
      expect(saved.mock.calls[0][0].changes[0].data).toBe(added);
      expect(rows.indexOf(added)).toBe(1);
      expect(added).toEqual({ id: 2, customer: 'Hopper', amount: 5 });
      expect(source.rowByKey(2)).toBe(added);
      expect(tracker.newRows).toEqual([]);
    });
  }

  it('keeps a new row whose save failed, with its values on it', async () => {
    const adapter = new ArrayAdapter<Order, number>({ data: [{ id: 1, customer: 'Ada', amount: 10 }], key: 'id', createKey: () => 1 });
    const source = new DataSource<Order, number>({ adapter, loadMode: 'all' });
    await source.load();
    const tracker = new ChangeTracker<Order, number>({ source, saveMode: 'wait' });
    const added = tracker.add({ customer: 'Hopper' });
    expect(await tracker.commit(added)).toBe(false);
    expect([tracker.statusOf(added), added.customer]).toEqual(['failed', 'Hopper']);
    // The same value again is no change, yet the failed row stays.
    tracker.setValue(added, 'customer', 'Hopper');
    expect(tracker.isUntouched(added)).toBe(false);
    expect(await tracker.commit(added)).toBe(false);
    expect(tracker.newRows).toEqual([added]);
    expect(tracker.newRows[0]).toBe(added);
    expect(tracker.pendingCount).toBe(1);
  });

  it('needs a key', () => {
    const source = new DataSource({ adapter: new ArrayAdapter({ data: [] }) });
    expect(() => new ChangeTracker({ source })).toThrow(expect.objectContaining({ code: 'MJD303' }));
  });
});
