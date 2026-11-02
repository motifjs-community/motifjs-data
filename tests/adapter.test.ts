import { DisposableStore, effect, MotifError, reactive, setUnexpectedErrorHandler } from '@motifx/core';
import { describe, expect, it, vi } from 'vitest';
import { data } from '../src';
const { ArrayAdapter, DataAdapter, DataError, RowKeys, queryArray, where } = data;

type Row = { id: number; name: string; qty: number };

const make = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `n${n - i}`, qty: i % 3 }));

/** A backend that can do only what it is given and records what it was asked. */
class TestAdapter extends DataAdapter<Row, number> {
  readonly asked: data.LoadOptions[] = [];
  readonly writes: string[] = [];
  batch = false;

  constructor(
    private readonly data: Row[],
    private readonly caps: Partial<data.Capabilities>,
    options: data.DataAdapterOptions<Row> = { key: 'id' },
  ) {
    super(options);
    if (!this.batch) this.saveBatch = undefined;
  }

  protected backendCapabilities(): data.Capabilities {
    return { filter: true, sort: true, paging: true, count: true, select: true, group: false, summary: false, insert: true, update: true, remove: true, ...this.caps };
  }

  protected async loadRows(options: data.LoadOptions): Promise<data.LoadResult<Row>> {
    this.asked.push(options);
    return queryArray(this.data, options);
  }

  protected override async insertRow(values: Partial<Row>) {
    this.writes.push(`insert:${values.name}`);
    if (values.name === 'bad') throw DataError.create('MJD202', { operation: 'insert', fields: { name: 'Bad name' } }, 'Bad name');
    return { id: 100 + this.writes.length };
  }

  protected override async updateRow(key: number, changes: Partial<Row>) {
    this.writes.push(`update:${key}:${JSON.stringify(changes)}`);
  }

  protected override async removeRow(key: number) {
    this.writes.push(`remove:${key}`);
    if (key === 13) throw new Error('locked');
  }

  /** Turns on a transport batch for one test. */
  enableBatch(fn: (changes: readonly data.Change<Row, number>[], o: data.OperationOptions) => Promise<data.BatchResult<Row>[]>) {
    this.saveBatch = fn;
  }
}

describe('DataAdapter: splitting a load between backend and memory', () => {
  const q: data.LoadOptions = { filter: where('qty', '=', 1), sort: [{ field: 'name', dir: 'asc' }], skip: 2, take: 3, count: true, select: ['id'] };

  it('sends everything to a backend that can do everything', async () => {
    const a = new TestAdapter(make(30), {});
    const r = await a.load(q);
    expect(a.asked[0]).toEqual({ filter: q.filter, sort: q.sort, skip: 2, take: 3, count: true, select: ['id'] });
    expect(r.total).toBe(10);
    expect(r.rows).toEqual([{ id: 23 }, { id: 20 }, { id: 17 }]);
  });

  it('filters in memory when the backend cannot, and pages and counts there too', async () => {
    const a = new TestAdapter(make(30), { filter: false });
    const r = await a.load(q);
    expect(a.asked[0]).toEqual({ sort: q.sort });
    expect(r.total).toBe(10);
    expect(r.rows).toEqual([{ id: 23 }, { id: 20 }, { id: 17 }]);
  });

  it('sorts in memory when the backend cannot', async () => {
    const a = new TestAdapter(make(30), { sort: false });
    const r = await a.load(q);
    expect(a.asked[0]).toEqual({ filter: q.filter });
    expect(r.rows).toEqual([{ id: 23 }, { id: 20 }, { id: 17 }]);
  });

  it('loads all rows when the backend can page but not count', async () => {
    const a = new TestAdapter(make(30), { count: false });
    const r = await a.load(q);
    expect(a.asked[0]).toEqual({ filter: q.filter, sort: q.sort, select: ['id'] });
    expect(r.total).toBe(10);
  });

  it('selects fields in memory when the backend cannot; options can turn capabilities off', async () => {
    const a = new TestAdapter(make(30), {}, { key: 'id', capabilities: { select: false, paging: false } });
    expect(a.capabilities.select).toBe(false);
    const r = await a.load(q);
    // Paging in memory loads every matching row, so the count is taken there too.
    expect(a.asked[0]).toEqual({ filter: q.filter, sort: q.sort });
    expect(r.total).toBe(10);
    expect(r.rows).toEqual([{ id: 23 }, { id: 20 }, { id: 17 }]);
  });

  it('groups and sums in memory when the backend cannot, over every matching row', async () => {
    const a = new TestAdapter(make(30), {});
    const options: data.LoadOptions = { filter: where('qty', '>=', 1), group: [{ field: 'qty' }], summary: [{ type: 'count' }], skip: 1, take: 1, count: true };
    const r = await a.load(options);
    expect(a.asked[0]).toEqual({ filter: options.filter });
    expect([r.total, r.groupCount, r.summary, r.groups?.map((g) => [g.key, g.count])]).toEqual([20, 2, [20], [[2, 10]]]);

    const capable = new TestAdapter(make(30), { group: true, summary: true });
    await capable.load(options);
    expect(capable.asked[0]).toMatchObject({ group: options.group, summary: options.summary, skip: 1, take: 1, count: true });

    // A filter made in memory takes the groups and summaries along.
    const noFilter = new TestAdapter(make(30), { filter: false, group: true, summary: true });
    const filtered = await noFilter.load(options);
    expect(noFilter.asked[0]).toEqual({});
    expect([filtered.summary, filtered.groupCount]).toEqual([[20], 2]);
  });

  it('fails when the backend leaves out the total it was asked for', async () => {
    class NoTotal extends TestAdapter {
      protected override async loadRows(): Promise<data.LoadResult<Row>> {
        return { rows: [] };
      }
    }
    await expect(new NoTotal([], {}).load({ count: true })).rejects.toMatchObject({ kind: 'parse', operation: 'load' });
  });

  it('rejects bad options with kind invalid', async () => {
    const a = new TestAdapter([], {});
    await expect(a.load({ take: -1 })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(a.load({ sort: [{ field: 'x', dir: 'up' as never }] })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(a.load({ filter: { field: 'x', op: 'nope' as never } })).rejects.toMatchObject({ kind: 'invalid', message: expect.stringContaining('nope') });
  });
});

describe('DataAdapter: operations, events, errors', () => {
  it('lets loading listeners change the options and reports loaded rows', async () => {
    const a = new TestAdapter(make(10), {});
    a.onLoading((e) => (e.options = { ...e.options, filter: where('qty', '=', 0) }));
    const loaded = vi.fn();
    a.onLoaded(loaded);
    const r = await a.load({ count: true });
    expect(r.total).toBe(4);
    expect(loaded).toHaveBeenCalledWith(expect.objectContaining({ result: r }));
  });

  it('counts and finds by key through the backend', async () => {
    const a = new TestAdapter(make(10), {});
    expect(await a.count({ filter: where('qty', '=', 2) })).toBe(3);
    expect(await a.byKey(4)).toMatchObject({ id: 4, name: 'n7' });
    expect(a.asked.at(-1)).toMatchObject({ filter: { field: 'id', op: '=', value: 4 }, take: 1 });
    expect(await a.byKey(99)).toBeUndefined();
  });

  it('inserts with values changed by a listener and merges what the backend returned', async () => {
    const a = new TestAdapter([], {});
    a.onInserting((e) => (e.values.qty = 7));
    const changed = vi.fn();
    a.onChanged(changed);
    const row = await a.insert({ name: 'x' });
    expect(row).toEqual({ name: 'x', qty: 7, id: 101 });
    expect(changed).toHaveBeenCalledWith({ changes: [{ type: 'insert', key: 101, data: row }], source: 'write' });
  });

  it('turns failures into DataError, reports them, and keeps cancellations quiet', async () => {
    const a = new TestAdapter([], {});
    const errors = vi.fn();
    a.onError(errors);
    await expect(a.insert({ name: 'bad' })).rejects.toMatchObject({ code: 'MJD202', kind: 'validation', plainMessage: 'Bad name', fields: { name: 'Bad name' } });
    await expect(a.remove(13)).rejects.toMatchObject({ code: 'MJD201', kind: 'server', plainMessage: 'locked', message: '[motifjs-data] MJD201: locked', operation: 'remove' });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(a.load({ signal: ctrl.signal })).rejects.toMatchObject({ kind: 'abort' });
    expect(errors).toHaveBeenCalledTimes(2);
    expect(DataError.from(new TypeError('Failed to fetch'), 'load').code).toBe('MJD101');
    expect(DataError.from(new DOMException('x', 'AbortError'), 'load').code).toBe('MJD105');
    const e = DataError.create('MJD103', { operation: 'load', status: 503 }, 503, 'Service Unavailable');
    expect(e).toBeInstanceOf(MotifError);
    expect(e.message).toBe('[motifjs-data] MJD103: The backend answered 503 Service Unavailable.');
  });

  it('subscriptions are IDisposable; a listener that throws goes to the error handler, the operation goes on', async () => {
    const a = new TestAdapter([], {});
    const seen = vi.fn();
    const sub = a.onChanged(seen);
    const unexpected = vi.fn();
    setUnexpectedErrorHandler(unexpected);
    try {
      a.onInserted(() => {
        throw new Error('listener broke');
      });
      await expect(a.insert({ name: 'x' })).resolves.toMatchObject({ name: 'x' });
      expect(unexpected).toHaveBeenCalledWith(expect.objectContaining({ message: 'listener broke' }));
    } finally {
      setUnexpectedErrorHandler(() => {});
    }
    expect(seen).toHaveBeenCalledTimes(1);
    sub.dispose();
    await a.insert({ name: 'y' });
    expect(seen).toHaveBeenCalledTimes(1);
    const store = new DisposableStore();
    a.onChanged(seen, undefined, store);
    store.dispose();
    a.dispose();
    await a.insert({ name: 'z' });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('stops an operation whose "before" listener sets cancel (core EventArgs)', async () => {
    const a = new TestAdapter([], {});
    a.onRemoving((e) => (e.cancel = e.key === 5));
    await expect(a.remove(5)).rejects.toMatchObject({ code: 'MJD106', kind: 'abort', operation: 'remove' });
    await a.remove(6);
    expect(a.writes).toEqual(['remove:6']);
    const out = await a.save([
      { type: 'remove', key: 5 },
      { type: 'remove', key: 7 },
    ]);
    expect(out.map((o) => o.ok)).toEqual([false, true]);
    expect(a.writes).toEqual(['remove:6', 'remove:7']);
  });

  it('refuses writes the backend cannot do, and writes without a key setting', async () => {
    const ro = new TestAdapter([], { insert: false });
    await expect(ro.insert({ name: 'x' })).rejects.toMatchObject({ kind: 'unsupported' });
    const keyless = new TestAdapter([], {}, {});
    await expect(keyless.remove(1)).rejects.toMatchObject({ kind: 'key' });
  });

  it('saves a batch one by one, reporting each outcome; a failure does not stop the rest', async () => {
    const a = new TestAdapter([], {});
    const changed = vi.fn();
    a.onChanged(changed);
    const out = await a.save([
      { type: 'remove', key: 13 },
      { type: 'update', key: 2, data: { name: 'two' } },
      { type: 'insert', data: { name: 'bad' } },
      { type: 'insert', data: { name: 'ok' } },
    ]);
    expect(a.writes).toEqual(['remove:13', 'update:2:{"name":"two"}', 'insert:bad', 'insert:ok']);
    expect(out.map((o) => o.ok)).toEqual([false, true, false, true]);
    expect(out[0]).toMatchObject({ ok: false, error: { code: 'MJD201', plainMessage: 'locked' } });
    expect(out[3]).toMatchObject({ ok: true, key: 104, row: { name: 'ok', id: 104 } });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0].changes).toHaveLength(2);
  });

  it('uses a transport batch when the adapter has one', async () => {
    const a = new TestAdapter([], {});
    const batch = vi.fn(async (changes: readonly data.Change<Row, number>[]) =>
      changes.map((c, i): data.BatchResult<Row> => (i === 1 ? { ok: false, error: new Error('nope') } : { ok: true, row: c.type === 'insert' ? { id: 50 } : undefined })),
    );
    a.enableBatch(batch);
    const out = await a.save([
      { type: 'insert', data: { name: 'a' } },
      { type: 'update', key: 1, data: { qty: 1 } },
    ]);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(a.writes).toEqual([]);
    expect(out).toMatchObject([{ ok: true, key: 50 }, { ok: false, error: { plainMessage: 'nope' } }]);
  });
});

describe('RowKeys', () => {
  it('reads composite keys as objects and compares them field by field', () => {
    const k = new RowKeys<{ order: number; line: number; at?: Date }>(['order', 'line']);
    const key = k.keyOf({ order: 7, line: 2 });
    expect(key).toEqual({ order: 7, line: 2 });
    expect(k.sameKey(key, { order: 7, line: 2 })).toBe(true);
    expect(k.sameKey(key, { order: 7, line: 3 })).toBe(false);
    expect(k.keyString(key)).toBe(k.keyString({ line: 2, order: 7 }));
    expect(k.keyFilter(key)).toEqual({ and: [{ field: 'order', op: '=', value: 7 }, { field: 'line', op: '=', value: 2 }] });
    const d = new RowKeys<{ at: Date }>('at');
    expect(d.sameKey(new Date(5), new Date(5))).toBe(true);
    expect(new RowKeys<Row>((r) => r.name.toUpperCase()).keyOf({ id: 1, name: 'ab', qty: 0 })).toBe('AB');
  });
});

describe('ArrayAdapter', () => {
  it('loads, finds and writes in place; keys must be unique', async () => {
    const data = make(5);
    const a = new ArrayAdapter<Row, number>({ data, key: 'id', createKey: (_v, rows) => Math.max(0, ...rows.map((r) => r.id)) + 1 });
    const page = await a.load({ sort: [{ field: 'name', dir: 'asc' }], take: 2, count: true });
    expect(page.rows.map((r) => r.id)).toEqual([5, 4]);
    expect(page.rows[0]).toBe(data[4]);
    expect(await a.byKey(3)).toBe(data[2]);

    const row = await a.insert({ name: 'new', qty: 1 });
    expect(row).toBe(data[5]);
    expect(row.id).toBe(6);
    await expect(a.insert({ id: 2, name: 'dup', qty: 0 })).rejects.toMatchObject({ kind: 'conflict' });

    await a.update(2, { name: 'two' });
    expect(data[1].name).toBe('two');
    await expect(a.update(2, { id: 3 })).rejects.toMatchObject({ kind: 'conflict' });
    await a.remove(1);
    expect(data.map((r) => r.id)).toEqual([2, 3, 4, 5, 6]);
    await expect(a.remove(1)).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('sorts in memory by the sortValue and compare of a field', async () => {
    const rows = [...make(6), { id: 7, name: 'n0', qty: NaN }];
    const order = [2, 0, 1];
    const a = new ArrayAdapter<Row, number>({
      data: rows,
      key: 'id',
      sortValue: (field) => (field === 'total' ? (row) => row.id * row.qty : undefined),
      compare: (field) => (field === 'qty' ? (x, y) => order.indexOf(x as number) - order.indexOf(y as number) : undefined),
    });
    const ids = async (sort: data.SortItem[]) => (await a.load({ sort })).rows.map((r) => r.id);
    expect(await ids([{ field: 'total', dir: 'asc' }])).toEqual([1, 4, 2, 5, 3, 6, 7]);
    expect(await ids([{ field: 'qty', dir: 'asc' }])).toEqual([3, 6, 1, 4, 2, 5, 7]);
    expect(await ids([{ field: 'qty', dir: 'desc' }])).toEqual([2, 5, 1, 4, 3, 6, 7]);
    expect(await ids([{ field: 'name', dir: 'asc' }])).toEqual([7, 6, 5, 4, 3, 2, 1]);

    // Another adapter that cannot sort uses them in its memory step.
    const backend = new TestAdapter(make(6), { sort: false }, { key: 'id', sortValue: (field) => (field === 'total' ? (row) => -row.id : undefined) });
    expect((await backend.load({ sort: [{ field: 'total', dir: 'asc' }] })).rows.map((r) => r.id)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('filters in memory by the filterValue of a field', async () => {
    const total = (field: string) => (field === 'total' ? (row: Row) => row.id * row.qty : undefined);
    const a = new ArrayAdapter<Row, number>({ data: make(6), key: 'id', filterValue: total });
    const ids = async (filter: data.FilterExpression) => (await a.load({ filter, count: true })).rows.map((r) => r.id);
    expect(await ids(where('total', '>=', 5))).toEqual([3, 5, 6]);
    expect(await ids(where('total', 'between', [2, 4]))).toEqual([2]);
    expect(await ids(where('total', 'contains', '1'))).toEqual([6]);
    expect(await ids(where('qty', '=', 0))).toEqual([1, 4]);
    expect(await a.count({ filter: where('total', '=', 0) })).toBe(2);

    // Another adapter that cannot filter uses it in its memory step.
    const backend = new TestAdapter(make(6), { filter: false }, { key: 'id', filterValue: total });
    expect((await backend.load({ filter: where('total', '>', 4), count: true })).rows.map((r) => r.id)).toEqual([3, 5, 6]);

    // A data source holding every row checks a pushed row with it.
    const rows = make(3);
    const source = new data.DataSource<Row, number>({ adapter: new ArrayAdapter<Row, number>({ data: rows, key: 'id', filterValue: total }), loadMode: 'all', filter: where('total', '>', 1) });
    await source.load();
    expect(source.rows.map((r) => r.id)).toEqual([2, 3]);
    source.adapter.push([
      { type: 'insert', key: 7, data: { id: 7, name: 'x', qty: 1 } },
      { type: 'insert', key: 8, data: { id: 8, name: 'y', qty: 0 } },
    ]);
    expect(source.rows.map((r) => r.id)).toEqual([2, 3, 7]);
  });

  it('applies pushed changes to the array and announces them', async () => {
    const data = make(3);
    const a = new ArrayAdapter<Row, number>({ data, key: 'id' });
    const changed = vi.fn();
    a.onChanged(changed);
    a.push([
      { type: 'update', key: 1, data: { qty: 9 } },
      { type: 'remove', key: 2 },
      { type: 'insert', key: 10, data: { id: 10, name: 'pushed', qty: 0 } },
    ]);
    expect(data.map((r) => [r.id, r.qty])).toEqual([
      [1, 9],
      [3, 2],
      [10, 0],
    ]);
    expect(changed.mock.calls[0][0].source).toBe('push');
  });

  it('writes through whatever array the app gives it, an app-side reactive array too', async () => {
    const state = reactive({ rows: make(3) });
    const a = new ArrayAdapter<Row, number>({ data: () => state.rows, key: 'id' });
    let names = '';
    effect(() => (names = state.rows.map((r) => r.name).join(',')));
    await a.update(1, { name: 'first' });
    await a.insert({ id: 9, name: 'nine', qty: 0 });
    await Promise.resolve();
    expect(names).toBe('first,n2,n1,nine');
  });
});

describe('ArrayAdapter keeps the given objects', () => {
  const kinds = { plain: <T extends object>(o: T) => o, reactive: <T extends object>(o: T) => reactive(o) as T };

  for (const [kind, give] of Object.entries(kinds)) {
    it(`stores and hands back the very objects, ${kind}`, async () => {
      const data: Row[] = [give({ id: 1, name: 'one', qty: 1 })];
      const a = new ArrayAdapter<Row, number>({ data, key: 'id', createKey: (_v, rows) => rows.length + 1 });
      const events: unknown[] = [];
      a.onInserting((e) => events.push(e.values));
      a.onInserted((e) => events.push(e.values, e.row));
      a.onChanged((e) => events.push(e.changes[0].data));

      const given = give({ name: 'two', qty: 2 }) as Row;
      const row = await a.insert(given);
      expect(row).toBe(given);
      expect(data[1]).toBe(given);
      expect(given.id).toBe(2);
      expect(events).toHaveLength(4);
      expect(events.every((x) => x === given)).toBe(true);
      expect(await a.byKey(2)).toBe(given);
      expect((await a.load({ sort: [{ field: 'name', dir: 'desc' }] })).rows[0]).toBe(given);

      expect(await a.update(2, { qty: 5 })).toBe(given);
      expect(given.qty).toBe(5);

      const three = give({ name: 'three', qty: 3 });
      const [saved] = await a.save([{ type: 'insert', data: three }]);
      expect(saved.ok && saved.row).toBe(three);
      expect(data[2]).toBe(three);

      const pushed = give({ id: 9, name: 'pushed', qty: 0 });
      a.push([{ type: 'insert', key: 9, data: pushed }]);
      expect(data[3]).toBe(pushed);
      a.push([{ type: 'update', key: 9, data: { qty: 4 } }]);
      expect(data[3]).toBe(pushed);
      expect(pushed.qty).toBe(4);

      await a.remove(2);
      a.push([{ type: 'remove', key: 9 }]);
      expect(data.map((r) => r.id)).toEqual([1, 3]);
    });
  }

  it('writes no key onto a row it refuses', async () => {
    const a = new ArrayAdapter<Row, number>({ data: make(2), key: 'id', createKey: () => 1 });
    const given = { name: 'x', qty: 0 } as Row;
    await expect(a.insert(given)).rejects.toMatchObject({ kind: 'conflict' });
    expect('id' in given).toBe(false);
  });

  it('hands back the given object when the array itself is reactive', async () => {
    const data = reactive(make(2));
    const a = new ArrayAdapter<Row, number>({ data, key: 'id' });
    const given = { id: 5, name: 'five', qty: 0 };
    expect(await a.insert(given)).toBe(given);
    expect(data.includes(given)).toBe(true);
  });

  it('writes the fields a backend sends back onto the given object', async () => {
    const a = new TestAdapter([], {});
    const given = { name: 'x' } as Row;
    const row = await a.insert(given);
    expect(row).toBe(given);
    expect(given.id).toBe(101);
  });
});
