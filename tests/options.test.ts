import { afterEach, describe, expect, it, vi } from 'vitest';
import { data } from '../src';
const { ArrayAdapter, ChangeTracker, DataAdapter, DataError, DataSource, queryArray, RestAdapter } = data;

type Row = { id: number; name: string; amount: number };

const rows = (): Row[] => [
  { id: 1, name: 'Ada', amount: 10 },
  { id: 2, name: 'Grace', amount: 20 },
  { id: 3, name: 'Hopper', amount: 30 },
];

/** `count` rows that load in blocks; records each load. */
class BlockAdapter extends DataAdapter<Row, number> {
  readonly loads: data.LoadOptions[] = [];
  private readonly all: Row[];

  constructor(count: number) {
    super({ key: 'id' });
    this.all = Array.from({ length: count }, (_, i) => ({ id: i, name: `r${i}`, amount: i }));
  }

  protected backendCapabilities(): data.Capabilities {
    return { filter: true, sort: true, paging: true, count: true, select: true, group: false, summary: false, insert: false, update: false, remove: false };
  }

  override load(options: data.LoadOptions = {}): Promise<data.LoadResult<Row>> {
    this.loads.push(options);
    return super.load(options);
  }

  protected async loadRows(options: data.LoadOptions): Promise<data.LoadResult<Row>> {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return queryArray(this.all, options);
  }
}

/** A tracker over rows in memory; `writes` lists what reached the adapter. */
async function tracker(saveMode: data.SaveMode, options: Partial<data.ChangeTrackerOptions<Row, number>> = {}) {
  const writes: string[] = [];
  const adapter = new ArrayAdapter<Row, number>({ data: rows(), key: 'id', createKey: (_, all) => Math.max(...all.map((r) => r.id)) + 1 });
  adapter.onInserting((e) => void writes.push(`insert ${e.values.name}`));
  adapter.onUpdating((e) => void writes.push(`update ${e.key} ${JSON.stringify(e.changes)}`));
  adapter.onRemoving((e) => void writes.push(`remove ${e.key}`));
  const source = new DataSource<Row, number>({ adapter, loadMode: 'all', sort: [{ field: 'id', dir: 'asc' }] });
  await source.load();
  const t = new ChangeTracker<Row, number>({ source, saveMode, ...options });
  return { tracker: t, source, writes, row: (id: number) => source.rowByKey(id)! };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DataSource options', () => {
  it('waits after a move of more than one block by default, and after jumpRows when given', async () => {
    vi.useFakeTimers();
    const plain = new BlockAdapter(10_000);
    const source = new DataSource<Row, number>({ adapter: plain, loadMode: 'blocks', pageSize: 50, scrollStopMs: 100 });
    source.ensure(0, 40);
    await vi.waitFor(() => expect(source.total).toBe(10_000));
    source.ensure(80, 120);
    expect(plain.loads.map((l) => l.skip)).toEqual([0]);
    await vi.advanceTimersByTimeAsync(100);
    expect(plain.loads.map((l) => l.skip)).toEqual([0, 50, 100]);

    const far = new BlockAdapter(10_000);
    const wide = new DataSource<Row, number>({ adapter: far, loadMode: 'blocks', pageSize: 50, scrollStopMs: 100, jumpRows: 500 });
    wide.ensure(0, 40);
    await vi.waitFor(() => expect(wide.total).toBe(10_000));
    wide.ensure(80, 120);
    expect(far.loads.map((l) => l.skip)).toEqual([0, 50, 100]);
  });

  it('keeps loading the blocks nearBlocks away from the view', async () => {
    const adapter = new BlockAdapter(10_000);
    const near = new DataSource<Row, number>({ adapter, loadMode: 'blocks', pageSize: 50, nearBlocks: 0 });
    await near.load();
    near.ensure(50, 90, true);
    near.ensure(100, 140, true);
    const first = adapter.loads.find((l) => l.skip === 50)!;
    expect(first.signal?.aborted).toBe(true);

    const other = new BlockAdapter(10_000);
    const kept = new DataSource<Row, number>({ adapter: other, loadMode: 'blocks', pageSize: 50 });
    await kept.load();
    kept.ensure(50, 90, true);
    kept.ensure(100, 140, true);
    expect(other.loads.find((l) => l.skip === 50)!.signal?.aborted).toBe(false);
  });
});

describe('ChangeTracker options and events', () => {
  it('saves deletions, updates, then new rows by default, and in saveOrder when given', async () => {
    const plain = await tracker('batch');
    plain.tracker.add({ name: 'New', amount: 1 });
    plain.tracker.setValue(plain.row(1), 'amount', 11);
    await plain.tracker.remove(plain.row(2));
    expect(plain.tracker.pendingRows().map((r) => r.name)).toEqual(['Grace', 'Ada', undefined]);
    await plain.tracker.saveChanges();
    expect(plain.tracker.pendingRows()).toEqual([]);
    expect(plain.writes).toEqual(['remove 2', 'update 1 {"amount":11}', 'insert New']);

    const own = await tracker('batch', { saveOrder: ['insert', 'update', 'remove'] });
    own.tracker.add({ name: 'New', amount: 1 });
    own.tracker.setValue(own.row(1), 'amount', 11);
    await own.tracker.remove(own.row(2));
    await own.tracker.saveChanges();
    expect(own.writes).toEqual(['insert New', 'update 1 {"amount":11}', 'remove 2']);
  });

  it('decides what is no change with sameValue', async () => {
    const plain = await tracker('batch');
    plain.tracker.setValue(plain.row(1), 'name', ' Ada ');
    expect(plain.tracker.isChanged(plain.row(1), 'name')).toBe(true);

    const trimmed = await tracker('batch', { sameValue: (a, b) => String(a ?? '').trim() === String(b ?? '').trim() });
    trimmed.tracker.setValue(trimmed.row(1), 'name', ' Ada ');
    expect(trimmed.tracker.isChanged(trimmed.row(1), 'name')).toBe(false);
  });

  it('tells before rows are sent: changes what goes out, keeps a row back, or cancels', async () => {
    const { tracker: t, row, writes } = await tracker('batch');
    const seen: string[] = [];
    let stop = false;
    t.onSaving((e) => {
      seen.push(e.changes.map((c) => c.type).join(','));
      if (stop) e.cancel = true;
      for (const [i, change] of e.changes.entries()) {
        if (change.type === 'update') change.data.name = 'Changed';
        if (e.rows[i] === row(3)) e.skip(e.rows[i]);
      }
    });
    t.setValue(row(1), 'amount', 11);
    t.setValue(row(3), 'amount', 31);
    expect(await t.saveChanges()).toEqual({ saved: 1, failed: 0 });
    expect(writes).toEqual(['update 1 {"amount":11,"name":"Changed"}']);
    expect(t.isChanged(row(3), 'amount')).toBe(true);

    stop = true;
    expect(await t.saveChanges()).toEqual({ saved: 0, failed: 0 });
    expect(writes).toHaveLength(1);
    expect([t.isChanged(row(3)), t.statusOf(row(3))]).toEqual([true, 'changed']);
    expect(seen).toEqual(['update,update', 'update']);
  });

  it('a row kept back in wait mode is not saved, and tells the outcome after a save', async () => {
    const { tracker: t, row } = await tracker('wait');
    const outcomes: boolean[] = [];
    t.onSaved((e) => outcomes.push(...e.outcomes.map((o) => o.ok)));
    const skip = t.onSaving((e) => e.skip(e.rows[0]));
    t.setValue(row(1), 'amount', 11);
    expect(await t.commit(row(1))).toBe(false);
    expect(outcomes).toEqual([]);
    skip.dispose();
    expect(await t.commit(row(1))).toBe(true);
    expect(outcomes).toEqual([true]);
  });
});

describe('HttpAdapter options', () => {
  const answer = (body: string | object, status: number, type = 'application/json') =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });

  it('cuts a text error at 300 characters by default, and at errorTextLength', async () => {
    const long = 'x'.repeat(400);
    const fetch = async () => answer(long, 500, 'text/plain');
    const plain = new RestAdapter<Row, number>({ url: '/api', key: 'id', fetch });
    await expect(plain.load()).rejects.toMatchObject({ plainMessage: `${'x'.repeat(300)}…` });
    const short = new RestAdapter<Row, number>({ url: '/api', key: 'id', fetch, errorTextLength: 10 });
    await expect(short.load()).rejects.toMatchObject({ plainMessage: `${'x'.repeat(10)}…` });
  });

  it('reads the error format with readError, and the built-in way when it returns nothing', async () => {
    let body: object = { problem: 'Locked', code: 'L1' };
    const fetch = async () => answer(body, 400);
    const adapter = new RestAdapter<Row, number>({
      url: '/api',
      key: 'id',
      fetch,
      readError: (response) => {
        const b = response.body as { problem?: string };
        return b.problem ? DataError.create('MJD203', { operation: response.request.operation, status: response.status, message: b.problem }) : undefined;
      },
    });
    await expect(adapter.load()).rejects.toMatchObject({ code: 'MJD203', plainMessage: 'Locked' });
    body = { message: 'Bad input' };
    await expect(adapter.load()).rejects.toMatchObject({ code: 'MJD202', plainMessage: 'Bad input' });
  });
});
