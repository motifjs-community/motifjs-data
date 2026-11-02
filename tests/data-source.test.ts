import { afterEach, describe, expect, it, vi } from 'vitest';
import { data } from '../src';
const { ArrayAdapter, DataAdapter, DataSource, queryArray, where } = data;

type City = { id: number; name: string; country: string; people: number };

const cities = (): City[] => [
  { id: 1, name: 'İstanbul', country: 'TR', people: 15 },
  { id: 2, name: 'Ankara', country: 'TR', people: 5 },
  { id: 3, name: 'Berlin', country: 'DE', people: 4 },
  { id: 4, name: 'Izmir', country: 'TR', people: 4 },
  { id: 5, name: 'Oslo', country: 'NO', people: 1 },
];

const cityAdapter = () => new ArrayAdapter<City, number>({ data: cities(), key: 'id', locale: 'tr' });

const changesOf = (source: data.DataSource<City, number>) => {
  const reasons: string[] = [];
  source.onChanged((e) => reasons.push(e.reason));
  return reasons;
};

/** `count` rows in memory; records each load and can hold or fail it. */
class TestAdapter extends DataAdapter<City, number> {
  readonly loads: data.LoadOptions[] = [];
  rows: City[];
  hold = false;
  failWith: Error | null = null;
  private waiting: (() => void)[] = [];

  constructor(count: number, capabilities?: Partial<data.Capabilities>) {
    super({ key: 'id', locale: 'tr', capabilities });
    this.rows = Array.from({ length: count }, (_, i) => ({ id: i, name: `c${i}`, country: 'TR', people: i }));
  }

  release() {
    const waiting = this.waiting;
    this.waiting = [];
    waiting.forEach((resume) => resume());
  }

  protected backendCapabilities(): data.Capabilities {
    return { filter: true, sort: true, paging: true, count: true, select: true, group: true, summary: true, insert: false, update: false, remove: false };
  }

  protected async loadRows(options: data.LoadOptions): Promise<data.LoadResult<City>> {
    this.loads.push(options);
    if (this.hold) await new Promise<void>((resolve) => this.waiting.push(resolve));
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (this.failWith) throw this.failWith;
    return queryArray(this.rows, options);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DataSource', () => {
  it('loads every row in all mode, filtered and sorted', async () => {
    const source = new DataSource<City, number>({ adapter: new ArrayAdapter({ data: cities(), key: 'id', locale: 'tr' }), loadMode: 'all', sort: [{ field: 'name', dir: 'asc' }] });
    const reasons = changesOf(source);
    expect(source.status).toBe('idle');
    await source.load();
    expect(reasons).toEqual(['loading', 'loaded']);
    expect(source.status).toBe('ready');
    expect(source.rows.map((c) => c.name)).toEqual(['Ankara', 'Berlin', 'Izmir', 'İstanbul', 'Oslo']);
    expect(source.total).toBe(5);

    await source.setFilter(where('country', '=', 'tr'));
    expect(reasons.slice(2)).toEqual(['query', 'loading', 'loaded']);
    expect(source.rows.map((c) => c.id)).toEqual([2, 4, 1]);
    expect(source.rowAt(2)?.name).toBe('İstanbul');
  });

  it('loads a page at a time with the total', async () => {
    const adapter = new TestAdapter(45);
    const source = new DataSource<City, number>({ adapter, pageSize: 20 });
    await source.load();
    expect(adapter.loads[0]).toMatchObject({ skip: 0, take: 20, count: true });
    expect([source.rows.length, source.total, source.pageCount, source.isLastPage]).toEqual([20, 45, 3, false]);

    await source.setPage(2);
    expect(source.rows.map((r) => r.id)).toEqual([40, 41, 42, 43, 44]);
    expect(source.rowAt(41)?.id).toBe(41);
    expect(source.isLastPage).toBe(true);
    await source.setPage(9);
    expect(source.pageIndex).toBe(2);

    // Without a count, a short page tells where the end is.
    const uncounted = new DataSource<City, number>({ adapter, pageSize: 20, count: false });
    await uncounted.load();
    expect([uncounted.total, uncounted.isLastPage]).toEqual([undefined, false]);
    await uncounted.setPage(2);
    expect([uncounted.total, uncounted.isLastPage]).toEqual([45, true]);
  });

  it('changes the page size, back to the first page; 0 is one page with every row', async () => {
    const adapter = new TestAdapter(45);
    const source = new DataSource<City, number>({ adapter, pageSize: 20 });
    await source.load();
    await source.setPage(1);
    const reasons = changesOf(source);
    await source.setPageSize(10);
    expect(reasons).toEqual(['cleared', 'loading', 'loaded']);
    expect(adapter.loads.at(-1)).toMatchObject({ skip: 0, take: 10, count: true });
    expect([source.pageSize, source.pageIndex, source.rows.length, source.pageCount]).toEqual([10, 0, 10, 5]);
    await source.setPage(4);
    expect(source.rows.map((r) => r.id)).toEqual([40, 41, 42, 43, 44]);

    await source.setPageSize(0);
    expect(adapter.loads.at(-1)?.take).toBeUndefined();
    expect([source.pageSize, source.pageIndex, source.rows.length, source.total, source.pageCount, source.isLastPage]).toEqual([0, 0, 45, 45, 1, true]);
    expect(source.rowAt(44)?.id).toBe(44);
    const loads = adapter.loads.length;
    await source.setPageSize(0);
    expect(adapter.loads).toHaveLength(loads);

    // Not loaded yet: the size waits for the first load; blocks keep theirs.
    const idle = new DataSource<City, number>({ adapter, pageSize: 20 });
    await idle.setPageSize(5);
    expect(adapter.loads).toHaveLength(loads);
    await idle.load();
    expect(idle.rows).toHaveLength(5);
    const blocks = new DataSource<City, number>({ adapter, loadMode: 'blocks', pageSize: 20 });
    expect(() => blocks.setPageSize(10)).toThrow(/size of a block is fixed/);
  });

  it('keeps the rows of the query before in all mode until the new ones arrive', async () => {
    const adapter = new TestAdapter(10);
    const source = new DataSource<City, number>({ adapter, loadMode: 'all' });
    await source.load();
    const reasons = changesOf(source);
    adapter.hold = true;
    const loading = source.setFilter(where('id', '<', 3));
    expect([source.status, source.rows.length, source.total, source.rowAt(9)?.id]).toEqual(['loading', 10, 10, 9]);
    adapter.hold = false;
    adapter.release();
    await loading;
    expect([source.status, source.rows.map((c) => c.id)]).toEqual(['ready', [0, 1, 2]]);
    expect(reasons).toEqual(['query', 'loading', 'loaded']);

    // A failed query does not leave the old rows next to its error.
    adapter.failWith = new Error('Down');
    await source.setFilter(where('id', '<', 5));
    expect([source.status, source.rows, source.total]).toEqual(['error', [], undefined]);

    const dropping = new DataSource<City, number>({ adapter: new TestAdapter(10), loadMode: 'all', keepRowsWhileLoading: false });
    await dropping.load();
    const dropped = changesOf(dropping);
    const next = dropping.setFilter(where('id', '<', 3));
    expect(dropping.rows).toEqual([]);
    await next;
    expect(dropped).toEqual(['query', 'cleared', 'loading', 'loaded']);
  });

  it('keeps the rows of a page at their own indexes while another page loads', async () => {
    const adapter = new TestAdapter(45);
    const source = new DataSource<City, number>({ adapter, pageSize: 20 });
    await source.load();
    adapter.hold = true;
    const turning = source.setPage(1);
    expect([source.status, source.pageIndex, source.loadedPageIndex]).toEqual(['loading', 1, 0]);
    expect([source.rows[0].id, source.rowAt(0)?.id, source.rowAt(20), source.indexOfKey(5)]).toEqual([0, 0, undefined, 5]);
    adapter.hold = false;
    adapter.release();
    await turning;
    expect([source.loadedPageIndex, source.rowAt(0), source.rowAt(20)?.id, source.indexOfKey(25)]).toEqual([1, undefined, 20, 25]);

    const sorting = source.setSort([{ field: 'id', dir: 'desc' }]);
    expect([source.pageIndex, source.loadedPageIndex, source.rows]).toEqual([0, -1, []]);
    await sorting;
    expect([source.loadedPageIndex, source.rowAt(0)?.id]).toEqual([0, 44]);
  });

  it('searches the search fields without case, in the locale', async () => {
    const source = new DataSource<City, number>({ adapter: new ArrayAdapter({ data: cities(), key: 'id', locale: 'tr' }), loadMode: 'all', searchFields: ['name', 'country'] });
    await source.search('İS');
    expect(source.rows.map((c) => c.name)).toEqual(['İstanbul']);
    await source.setQuery({ searchText: 'o', filter: where('people', '<', 5) });
    expect(source.rows.map((c) => c.name)).toEqual(['Oslo']);
    await source.search('');
    expect(source.rows.map((c) => c.name)).toEqual(['Berlin', 'Izmir', 'Oslo']);

    const plain = new DataSource<City, number>({ adapter: new ArrayAdapter({ data: cities(), key: 'id' }) });
    expect(() => plain.search('x')).toThrow(expect.objectContaining({ code: 'MJD302' }));
  });

  it('loads a range of the current query without touching its rows', async () => {
    const adapter = new TestAdapter(45);
    const source = new DataSource<City, number>({ adapter, pageSize: 20, filter: where('people', '>=', 10), sort: [{ field: 'people', dir: 'desc' }], params: { tenant: 1 } });
    await source.load();
    const reasons = changesOf(source);
    const part = await source.loadRange({ skip: 5, take: 10, count: true, filter: where('people', '<', 40) });
    expect(part.rows.map((r) => r.id)).toEqual([34, 33, 32, 31, 30, 29, 28, 27, 26, 25]);
    expect(part.total).toBe(30);
    expect(adapter.loads.at(-1)).toMatchObject({ skip: 5, take: 10, count: true, params: { tenant: 1 } });
    expect(reasons).toEqual([]);
    expect(source.rows.map((r) => r.id).slice(0, 2)).toEqual([44, 43]);

    adapter.failWith = new Error('down');
    await expect(source.loadRange({ take: 5 })).rejects.toThrow();
  });

  it('keeps only the answer of the last query', async () => {
    const adapter = new TestAdapter(30);
    adapter.hold = true;
    const source = new DataSource<City, number>({ adapter, loadMode: 'all' });
    const first = source.setFilter(where('id', '<', 10));
    const second = source.setFilter(where('id', '>=', 25));
    expect(adapter.loads[0].signal?.aborted).toBe(true);
    adapter.release();
    await Promise.all([first, second]);
    expect(source.rows.map((r) => r.id)).toEqual([25, 26, 27, 28, 29]);
  });

  it('reports a failed load without rejecting, and loads again on retry', async () => {
    const adapter = new TestAdapter(5);
    adapter.failWith = new Error('Database is down');
    const source = new DataSource<City, number>({ adapter });
    const reasons = changesOf(source);
    await expect(source.load()).resolves.toBeUndefined();
    expect(source.status).toBe('error');
    expect(source.error).toMatchObject({ code: 'MJD201', plainMessage: 'Database is down' });
    expect(reasons).toEqual(['loading', 'failed']);

    adapter.failWith = null;
    await source.retry();
    expect([source.status, source.error, source.rows.length]).toEqual(['ready', null, 5]);
  });

  it('finds rows by key: loaded ones without a request, others once', async () => {
    const adapter = new ArrayAdapter<City, number>({ data: cities(), key: 'id' });
    const byKey = vi.spyOn(adapter, 'byKey');
    const source = new DataSource<City, number>({ adapter, pageSize: 2, sort: [{ field: 'id', dir: 'asc' }] });
    await source.setPage(1);
    expect(source.indexOfKey(4)).toBe(3);
    expect(source.rowByKey(1)).toBeUndefined();
    expect((await source.byKey(3))?.name).toBe('Berlin');
    expect(byKey).not.toHaveBeenCalled();

    expect((await source.byKey(5))?.name).toBe('Oslo');
    expect((await source.byKey(5))?.name).toBe('Oslo');
    expect(byKey).toHaveBeenCalledTimes(1);
    expect(source.rowByKey(5)?.name).toBe('Oslo');
  });

  it('applies changes saved through the adapter to the loaded rows', async () => {
    const adapter = cityAdapter();
    const source = new DataSource<City, number>({ adapter, loadMode: 'all', filter: where('country', '=', 'TR'), sort: [{ field: 'people', dir: 'desc' }] });
    await source.load();
    const istanbul = source.rowByKey(1)!;
    const events: data.DataSourceChange<City>[] = [];
    source.onChanged((e) => events.push(e));

    await adapter.update(1, { people: 16 });
    expect(istanbul.people).toBe(16);
    expect(events.at(-1)).toEqual({ reason: 'rows', rows: [istanbul] });

    await adapter.insert({ id: 6, name: 'Bursa', country: 'TR', people: 3 });
    await adapter.insert({ id: 7, name: 'Paris', country: 'FR', people: 2 });
    expect(source.rows.map((c) => c.name)).toEqual(['İstanbul', 'Ankara', 'Izmir', 'Bursa']);
    expect(source.total).toBe(4);

    await adapter.remove(2);
    expect(source.rows.map((c) => c.name)).toEqual(['İstanbul', 'Izmir', 'Bursa']);
    expect(source.total).toBe(3);

    adapter.push([{ type: 'update', key: 4, data: { name: 'İzmir' } }]);
    expect(source.rowAt(1)?.name).toBe('İzmir');
  });

  it('loads blocks where the view is, counting once', async () => {
    const adapter = new TestAdapter(1000);
    const source = new DataSource<City, number>({ adapter, loadMode: 'blocks', pageSize: 50 });
    const reasons = changesOf(source);
    await source.load();
    expect(adapter.loads.map((l) => [l.skip, l.take, l.count])).toEqual([[0, 50, true]]);
    expect([source.status, source.total, source.rowAt(49)?.id, source.rowAt(50)]).toEqual(['ready', 1000, 49, undefined]);
    expect(reasons).toEqual(['loading', 'loaded']);

    source.ensure(30, 80);
    await vi.waitFor(() => expect(source.rowAt(79)?.id).toBe(79));
    expect(adapter.loads.map((l) => [l.skip, !!l.count])).toEqual([
      [0, true],
      [50, false],
    ]);
  });

  it('waits for scrolling to stop after a jump and aborts blocks left behind', async () => {
    vi.useFakeTimers();
    const adapter = new TestAdapter(10_000);
    const source = new DataSource<City, number>({ adapter, loadMode: 'blocks', pageSize: 50, scrollStopMs: 100 });
    source.ensure(0, 40);
    await vi.waitFor(() => expect(source.total).toBe(10_000));

    // A drag over the scroll bar: nothing passed over is requested.
    source.ensure(2000, 2040);
    await vi.advanceTimersByTimeAsync(50);
    source.ensure(5000, 5040);
    await vi.advanceTimersByTimeAsync(50);
    source.ensure(8000, 8040);
    expect(adapter.loads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(adapter.loads.map((l) => l.skip)).toEqual([0, 8000]);

    // A block that leaves the view while loading is aborted.
    adapter.hold = true;
    source.ensure(8040, 8100);
    source.ensure(8100, 8150, true);
    source.ensure(500, 540, true);
    const loading = adapter.loads.slice(2);
    expect(loading.map((l) => [l.skip, l.signal?.aborted])).toEqual([
      [8050, true],
      [8100, true],
      [500, false],
    ]);
    adapter.release();
  });

  it('is loading in blocks mode until the first block of a new query or a reload arrives', async () => {
    const adapter = new TestAdapter(200);
    const source = new DataSource<City, number>({ adapter, loadMode: 'blocks', pageSize: 50 });
    await source.load();
    const reasons = changesOf(source);
    adapter.hold = true;
    const query = source.setFilter(where('id', '>=', 100));
    expect([source.status, source.total, source.rowAt(0)]).toEqual(['loading', undefined, undefined]);
    adapter.hold = false;
    adapter.release();
    await query;
    expect([source.status, source.total, source.rowAt(0)?.id]).toEqual(['ready', 100, 100]);
    expect(reasons).toEqual(['query', 'cleared', 'loading', 'loaded']);

    const reloading = source.reload();
    expect(source.status).toBe('loading');
    await reloading;
    expect([source.status, reasons.slice(4)]).toEqual(['ready', ['reload', 'loading', 'loaded']]);

    // An empty result is asked for again.
    await source.setFilter(where('id', '<', 0));
    const asked = adapter.loads.length;
    await source.reload();
    expect([adapter.loads.length, source.status, source.total]).toEqual([asked + 1, 'ready', 0]);

    // A reload that fails before any block arrives is an error, not a load that never ends.
    adapter.failWith = new Error('Down');
    await source.reload();
    expect([source.status, source.error?.plainMessage]).toEqual(['error', 'Down']);
  });

  it('keeps a failed block apart and loads it again on retry', async () => {
    const adapter = new TestAdapter(200);
    const source = new DataSource<City, number>({ adapter, loadMode: 'blocks', pageSize: 50 });
    await source.load();
    adapter.failWith = new Error('Timeout');
    source.ensure(50, 100, true);
    await vi.waitFor(() => expect(source.failedBlocks).toBe(1));
    expect([source.status, source.isFailed(60), source.isFailed(10)]).toEqual(['ready', true, false]);

    adapter.failWith = null;
    await source.retry();
    expect([source.failedBlocks, source.rowAt(60)?.id]).toEqual([0, 60]);
  });

  it('finds the end of the rows from a short block when blocks load without a count', async () => {
    const adapter = new TestAdapter(120, { count: false });
    const source = new DataSource<City, number>({ adapter, loadMode: 'blocks', pageSize: 50, count: false });
    await source.load();
    expect([adapter.loads[0].count, adapter.loads[0].take, source.total]).toEqual([undefined, 50, undefined]);
    source.ensure(50, 150, true);
    await vi.waitFor(() => expect(source.total).toBe(120));
    expect(adapter.loads.every((l) => !l.count && l.take === 50)).toBe(true);

    // An empty block ends the rows right after a full one.
    const even = new TestAdapter(100, { count: false });
    const exact = new DataSource<City, number>({ adapter: even, loadMode: 'blocks', pageSize: 50, count: false });
    await exact.load();
    exact.ensure(50, 100, true);
    await vi.waitFor(() => expect(exact.rowAt(99)?.id).toBe(99));
    expect(exact.total).toBeUndefined();
    exact.ensure(100, 150, true);
    await vi.waitFor(() => expect(exact.total).toBe(100));

    // A block that fails after the first one leaves the source ready.
    const later = new DataSource<City, number>({ adapter: new TestAdapter(200, { count: false }), loadMode: 'blocks', pageSize: 50, count: false });
    await later.load();
    (later.adapter as TestAdapter).failWith = new Error('Timeout');
    later.ensure(50, 100, true);
    await vi.waitFor(() => expect(later.failedBlocks).toBe(1));
    expect(later.status).toBe('ready');
  });

  it('loads blocks again when rows come or go', async () => {
    const adapter = cityAdapter();
    const source = new DataSource<City, number>({ adapter, loadMode: 'blocks', pageSize: 2 });
    await source.load();
    const loaded = () => [0, 1, 2, 3, 4].map((i) => source.rowAt(i)?.id);
    source.ensure(0, 5, true);
    await vi.waitFor(() => expect(loaded()).toEqual([1, 2, 3, 4, 5]));

    await adapter.remove(2);
    await vi.waitFor(() => expect(loaded()).toEqual([1, 3, 4, 5, undefined]));
    expect(source.total).toBe(4);
  });

  it('groups every row with summaries in all mode, and keeps them right after changes', async () => {
    const adapter = cityAdapter();
    const source = new DataSource<City, number>({
      adapter,
      loadMode: 'all',
      group: [{ field: 'country' }],
      sort: [{ field: 'people', dir: 'desc' }],
      groupSummary: [{ type: 'sum', field: 'people' }],
      summary: [{ type: 'count' }, { type: 'max', field: 'people' }],
    });
    await source.load();
    const shape = () => source.groups.map((g) => [g.key, g.count, g.summary, g.items!.map((c) => c.id)]);
    expect(shape()).toEqual([
      ['DE', 1, [4], [3]],
      ['NO', 1, [1], [5]],
      ['TR', 3, [24], [1, 2, 4]],
    ]);
    expect([source.rows.map((c) => c.id), source.summary, source.groupCount]).toEqual([[3, 5, 1, 2, 4], [5, 15], 3]);

    await adapter.update(5, { country: 'DE' });
    await adapter.insert({ id: 6, name: 'Bursa', country: 'TR', people: 3 });
    await adapter.remove(1);
    expect(shape()).toEqual([
      ['DE', 2, [5], [3, 5]],
      ['TR', 3, [12], [2, 4, 6]],
    ]);
    expect(source.summary).toEqual([5, 5]);
  });

  it('pages over groups, and loads the totals once per query', async () => {
    const adapter = new TestAdapter(45);
    adapter.rows.forEach((r) => (r.country = `c${Math.floor(r.id / 10)}`));
    const source = new DataSource<City, number>({ adapter, pageSize: 2, group: [{ field: 'country' }], summary: [{ type: 'sum', field: 'people' }] });
    const reasons = changesOf(source);
    await source.load();
    expect(source.groups.map((g) => [g.key, g.count])).toEqual([
      ['c0', 10],
      ['c1', 10],
    ]);
    expect([source.groupCount, source.pageCount, source.total, source.summary]).toEqual([5, 3, 45, [990]]);
    expect(reasons).toContain('summary');

    const loads = adapter.loads.length;
    await source.setPage(2);
    expect(source.groups.map((g) => g.key)).toEqual(['c4']);
    expect(adapter.loads.length).toBe(loads + 1);

    await source.setFilter(where('id', '<', 10));
    expect([source.summary, source.groupCount]).toEqual([[45], 1]);
  });

  it('groups pages in memory from one load per row set when the adapter cannot group', async () => {
    const adapter = new TestAdapter(45, { group: false, summary: false });
    adapter.rows.forEach((r) => (r.country = `c${Math.floor(r.id / 10)}`));
    const source = new DataSource<City, number>({
      adapter,
      pageSize: 2,
      select: ['id', 'name'],
      group: [{ field: 'country' }],
      groupSummary: [{ type: 'sum', field: 'people' }],
      summary: [{ type: 'sum', field: 'people' }],
    });
    await source.load();
    expect(adapter.loads).toHaveLength(1);
    expect(adapter.loads[0].select).toBeUndefined();
    expect(source.groups.map((g) => [g.key, g.count, g.summary])).toEqual([
      ['c0', 10, [45]],
      ['c1', 10, [145]],
    ]);
    expect(source.groups[0].items![0]).toEqual({ id: 0, name: 'c0' });
    expect([source.groupCount, source.pageCount, source.total, source.summary]).toEqual([5, 3, 45, [990]]);

    await source.setPage(2);
    expect(source.groups.map((g) => g.key)).toEqual(['c4']);
    await source.setSort([{ field: 'id', dir: 'desc' }]);
    expect([source.groups.map((g) => g.key), source.groups[0].items![0]]).toEqual([['c0', 'c1'], { id: 9, name: 'c9' }]);
    await source.setGroup([]);
    expect([source.rows.map((c) => c.id), source.pageCount, source.summary]).toEqual([[44, 43], 23, [990]]);
    expect(adapter.loads).toHaveLength(1);

    // Another row set: every row for the summary, and the first page apart.
    await source.setFilter(where('id', '<', 10));
    expect(adapter.loads).toHaveLength(3);
    expect([source.summary, source.total]).toEqual([[45], 10]);
  });

  it('takes the summaries from every matching row, keeps them for groups, and applies changes to them', async () => {
    const adapter = new TestAdapter(45, { group: false, summary: false });
    adapter.rows.forEach((r) => (r.country = `c${Math.floor(r.id / 10)}`));
    const source = new DataSource<City, number>({ adapter, pageSize: 2, filter: where('id', '<', 20), summary: [{ type: 'count' }, { type: 'sum', field: 'people' }] });
    await source.load();
    // The first page does not wait for every row.
    expect(adapter.loads.map((o) => o.take)).toEqual([undefined, 2]);
    expect([source.rows.map((c) => c.id), source.summary]).toEqual([[0, 1], [20, 190]]);

    await source.setPage(1);
    await source.setGroup([{ field: 'country' }]);
    expect(source.groups.map((g) => [g.key, g.count])).toEqual([
      ['c0', 10],
      ['c1', 10],
    ]);
    expect(adapter.loads).toHaveLength(2);

    const reasons = changesOf(source);
    adapter.push([
      { type: 'update', key: 3, data: { people: 103 } },
      { type: 'remove', key: 15 },
      { type: 'insert', key: 50, data: { id: 50, name: 'c50', country: 'c0', people: 50 } },
      { type: 'insert', key: -1, data: { id: -1, name: 'new', country: 'c0', people: 7 } },
    ]);
    expect(reasons).toEqual(['rows']);
    expect(source.groups.map((g) => [g.key, g.count])).toEqual([
      ['c0', 11],
      ['c1', 9],
    ]);
    expect(source.summary).toEqual([20, 190 + 100 - 15 + 7]);
    expect(adapter.loads).toHaveLength(2);
  });

  it('turns pages without a request when the adapter cannot filter', async () => {
    const adapter = new TestAdapter(45, { filter: false });
    const source = new DataSource<City, number>({ adapter, pageSize: 10, filter: where('id', '<', 25) });
    await source.load();
    await source.setPage(2);
    expect([source.rows.map((c) => c.id), source.total, source.pageCount]).toEqual([[20, 21, 22, 23, 24], 25, 3]);
    expect(adapter.loads).toHaveLength(1);
    expect(adapter.loads[0].filter).toBeUndefined();
  });

  it("sorts in memory with the adapter's compare, rows saved later too", async () => {
    const order = ['NO', 'TR', 'DE'];
    const adapter = new ArrayAdapter<City, number>({
      data: cities(),
      key: 'id',
      compare: (field) => (field === 'country' ? (a, b) => order.indexOf(a as string) - order.indexOf(b as string) : undefined),
    });
    const source = new DataSource<City, number>({ adapter, loadMode: 'all', sort: [{ field: 'country', dir: 'asc' }, { field: 'id', dir: 'asc' }] });
    await source.load();
    expect(source.rows.map((c) => c.id)).toEqual([5, 1, 2, 4, 3]);
    await adapter.insert({ id: 6, name: 'Bergen', country: 'NO', people: 1 });
    expect(source.rows.map((c) => c.id)).toEqual([5, 6, 1, 2, 4, 3]);
  });

  it('loads the groups of the query without rows, from an adapter that groups or from every row', async () => {
    for (const group of [true, false]) {
      const adapter = new TestAdapter(45, { group });
      adapter.rows.forEach((r) => (r.country = `c${Math.floor(r.id / 10)}`));
      const source = new DataSource<City, number>({ adapter, loadMode: 'blocks', pageSize: 10, filter: where('id', '>=', 5) });
      const groups = await source.loadGroups([{ field: 'country', dir: 'desc' }]);
      expect(groups.map((g) => [g.key, g.count, g.items])).toEqual([
        ['c4', 5, undefined],
        ['c3', 10, undefined],
        ['c2', 10, undefined],
        ['c1', 10, undefined],
        ['c0', 5, undefined],
      ]);
      const asked = adapter.loads.at(-1)!;
      expect([asked.group, asked.groupsOnly, asked.filter]).toEqual(group ? [[{ field: 'country', dir: 'desc' }], true, where('id', '>=', 5)] : [undefined, undefined, where('id', '>=', 5)]);
    }
  });

  it('loads other group summaries with the groups, and summaries of the query apart from its rows', async () => {
    for (const summary of [true, false]) {
      const adapter = new TestAdapter(45, { summary });
      adapter.rows.forEach((r) => (r.country = `c${Math.floor(r.id / 10)}`));
      const source = new DataSource<City, number>({ adapter, loadMode: 'blocks', pageSize: 10, filter: where('id', '>=', 5), groupSummary: [{ type: 'count' }] });
      const groups = await source.loadGroups([{ field: 'country' }], { groupSummary: [{ type: 'max', field: 'people' }] });
      expect(groups.map((g) => [g.key, g.summary])).toEqual([
        ['c0', [9]],
        ['c1', [19]],
        ['c2', [29]],
        ['c3', [39]],
        ['c4', [44]],
      ]);
      await source.search('');
      const values = await source.loadSummary([{ type: 'sum', field: 'people' }, { type: 'count' }]);
      // 5 + … + 44
      expect(values).toEqual([980, 40]);
      const asked = adapter.loads.at(-1)!;
      expect([asked.summary, asked.take, asked.filter]).toEqual(summary ? [[{ type: 'sum', field: 'people' }, { type: 'count' }], 0, where('id', '>=', 5)] : [undefined, undefined, where('id', '>=', 5)]);
      expect(source.summary).toEqual([]);
    }
    const source = new DataSource<City, number>({ adapter: new TestAdapter(3), loadMode: 'all' });
    expect(await source.loadSummary([])).toEqual([]);
  });

  it('loads a range in another order, and blocks of several runs of rows', async () => {
    const adapter = new TestAdapter(100);
    const source = new DataSource<City, number>({ adapter, loadMode: 'blocks', pageSize: 10 });
    const range = await source.loadRange({ skip: 0, take: 3, sort: [{ field: 'id', dir: 'desc' }] });
    expect(range.rows.map((c) => c.id)).toEqual([99, 98, 97]);
    await source.load();
    adapter.loads.length = 0;
    source.ensureRanges(
      [
        [12, 14],
        [75, 77],
      ],
      true,
    );
    await vi.waitFor(() => expect(source.rowAt(76)?.id).toBe(76));
    expect(adapter.loads.map((o) => o.skip).sort((a, b) => a! - b!)).toEqual([10, 70]);
    expect(source.rowAt(13)?.id).toBe(13);
  });

  it('does not group in blocks mode', () => {
    expect(() => new DataSource({ adapter: cityAdapter(), loadMode: 'blocks', group: [{ field: 'country' }] })).toThrow(expect.objectContaining({ code: 'MJD302' }));
  });

  it('stops after dispose', async () => {
    const adapter = new TestAdapter(10);
    adapter.hold = true;
    const source = new DataSource<City, number>({ adapter });
    const reasons = changesOf(source);
    const pending = source.load();
    source.dispose();
    adapter.release();
    await pending;
    expect(adapter.loads[0].signal?.aborted).toBe(true);
    expect(reasons).toEqual(['loading']);
  });
});
