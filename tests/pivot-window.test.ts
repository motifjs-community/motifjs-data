import { describe, expect, it } from 'vitest';
import { data } from '../src';
const { ArrayAdapter, pivotCells, pivotCounts, pivotMembers, queryPivot, where } = data;

type Sale = { id: number; region: string | null; city: string; day: string; amount: number | null; units: number };

const sales: Sale[] = [
  { id: 1, region: 'North', city: 'Oslo', day: '2023-11-02', amount: 100, units: 1 },
  { id: 2, region: 'north', city: 'Bergen', day: '2024-01-15', amount: 50, units: 2 },
  { id: 3, region: 'South', city: 'Rome', day: '2024-02-01', amount: 30, units: 3 },
  { id: 4, region: 'South', city: 'Rome', day: '2024-07-04', amount: null, units: 4 },
  { id: 5, region: null, city: 'Nowhere', day: '2023-05-05', amount: 20, units: 5 },
  { id: 6, region: 'South', city: 'Milan', day: '2023-12-31', amount: 10, units: 6 },
  { id: 7, region: 'East', city: 'Kyiv', day: '2024-03-03', amount: 70, units: 7 },
];
const ctx: data.EvaluateContext = { locale: 'en-US', fields: { day: 'date' } };
const sum = { type: 'sum', field: 'amount' } as const;
const count = { type: 'count' } as const;
const region = { field: 'region' } as const;
const city = { field: 'city' } as const;
const year = { field: 'day', interval: 'year' } as const;
const quarter = { field: 'day', interval: 'quarter' } as const;

const keysOf = (r: data.PivotMembersResult) => r.slices.map((s) => [s.total, s.members.map((m) => m.key)]);

describe('pivot windows in memory', () => {
  it('gives a part of the top members in order, the empty one last, with their totals and the number of all', () => {
    const r = pivotMembers(sales, { levels: [region, city], slices: [{ parent: [], skip: 1, take: 2 }], measures: [sum, count] }, ctx);
    expect(keysOf(r)).toEqual([[4, ['North', 'South']]]);
    expect(r.slices[0].members.map((m) => [m.path, m.count, m.values])).toEqual([
      [['North'], 2, [150, 2]],
      [['South'], 3, [40, 3]],
    ]);
    const all = pivotMembers(sales, { levels: [{ ...region, dir: 'desc' }], slices: [{ parent: [] }] }, ctx);
    expect(keysOf(all)).toEqual([[4, ['South', 'North', 'East', null]]]);
  });

  it('gives the children of several parents, each its own part, with the number of their children', () => {
    const r = pivotMembers(sales, { levels: [region, city, year], slices: [{ parent: ['south'], take: 1 }, { parent: ['North'] }], measures: [sum], childCounts: true }, ctx);
    expect(keysOf(r)).toEqual([
      [2, ['Milan']],
      [2, ['Bergen', 'Oslo']],
    ]);
    expect(r.slices[1].members.map((m) => [m.path, m.values, m.childCount])).toEqual([
      [['North', 'Bergen'], [50], 1],
      [['North', 'Oslo'], [100], 1],
    ]);
    expect(r.slices[0].members[0].childCount).toBe(1);
  });

  it('orders members by a measure at the total or in a member of the other axis, those without a value last', () => {
    const at = (path?: unknown[], dir?: 'asc' | 'desc') =>
      keysOf(pivotMembers(sales, { levels: [{ ...region, dir }], slices: [{ parent: [] }], measures: [sum], sortBySummary: { measure: 0, levels: [year], path } }, ctx))[0][1];
    expect(at()).toEqual([null, 'South', 'East', 'North']);
    expect(at(undefined, 'desc')).toEqual(['North', 'East', 'South', null]);
    // In 2024: north 50, South 30 (and an empty amount), East 70; the empty region has no row then.
    expect(at([2024], 'desc')).toEqual(['East', 'North', 'South', null]);
  });

  it('finds the places of members among their parent children, as the slices order them', () => {
    const find = [['South', 'Rome'], ['North', 'oslo'], ['North', 'Paris'], [null, 'Nowhere']];
    const byName = pivotMembers(sales, { levels: [region, city], slices: [{ parent: ['South'], take: 0 }], find }, ctx);
    expect(byName.found).toEqual([1, 1, -1, 0]);
    const bySum = pivotMembers(sales, { levels: [region, { ...city, dir: 'desc' }], slices: [{ parent: ['South'], take: 0 }], measures: [sum], sortBySummary: { measure: 0 }, find }, ctx);
    // South: Rome 30, Milan 10, desc; North: Oslo 100, Bergen 50.
    expect(bySum.found).toEqual([0, 0, -1, 0]);
  });

  it('counts the children of members on any level', () => {
    const r = pivotCounts(sales, { levels: [region, city, year], paths: [[], ['South'], ['South', 'Rome'], ['Nowhere land']] }, ctx);
    expect([r.childCount([]), r.childCount(['south']), r.childCount(['South', 'Rome']), r.childCount(['Nowhere land'])]).toEqual([4, 2, 1, 0]);
    const dates = pivotCounts(sales, { levels: [year, quarter], paths: [[2023], [2024]] }, ctx);
    expect([dates.childCount([2023]), dates.childCount([2024])]).toEqual([2, 2]);
  });

  it('gives the crossings asked for, totals included, the same as the whole pivot', () => {
    const rows = [region, city];
    const columns = [year, quarter];
    const rowPaths = [[], ['South'], ['South', 'Rome'], [null]];
    const columnPaths = [[], [2024], [2024, 1], [2023, 4]];
    const cells = pivotCells(sales, { rows, columns, measures: [sum, count], rowPaths, columnPaths }, ctx);
    const whole = queryPivot(sales, { rows, columns, measures: [sum, count] }, ctx);
    const find = (root: data.PivotMember, path: unknown[]) => path.reduce<data.PivotMember | undefined>((m, key) => m?.children?.find((c) => c.key === key), root);
    for (const r of rowPaths) {
      for (const c of columnPaths) {
        expect([r, c, cells.values(r, c)]).toEqual([r, c, whole.values(find(whole.rows, r)!, find(whole.columns, c)!)]);
      }
    }
    expect([cells.count(['South'], [2024]), cells.count(['south', 'rome'], []), cells.values(['North'], [2024, 3])]).toEqual([2, 2, undefined]);
  });

  it('applies the filter and keep of the pivot to every part', () => {
    const keep = [{ field: 'day', intervals: ['year'] as data.PivotInterval[], paths: [[2024]] }];
    const filter = where('units', '<', 7);
    const members = pivotMembers(sales, { filter, keep, levels: [region], slices: [{ parent: [] }], measures: [sum] }, ctx);
    expect(members.slices[0].members.map((m) => [m.key, m.values[0]])).toEqual([
      ['north', 50],
      ['South', 30],
    ]);
    expect(pivotCounts(sales, { filter, keep, levels: [region, city], paths: [[]] }, ctx).childCount([])).toBe(2);
    expect(pivotCells(sales, { filter, keep, rows: [region], columns: [], measures: [count], rowPaths: [[]], columnPaths: [[]] }, ctx).count([], [])).toBe(3);
  });
});

/** An array that answers as a backend computing the parts of pivots: the answers pass through JSON, as from a server. */
class Server extends ArrayAdapter<Sale, number> {
  readonly asked: string[] = [];
  constructor() {
    super({ data: sales, key: 'id', fields: { day: 'date' }, locale: 'en-US' });
  }
  protected override backendCapabilities(): data.Capabilities {
    return { ...super.backendCapabilities(), pivot: true, pivotWindow: true };
  }
  protected override async loadPivotMemberSlices(o: data.PivotMembersOptions<Sale>): Promise<unknown> {
    this.asked.push('members');
    return JSON.parse(JSON.stringify(pivotMembers(sales, o, this.evaluateContext)));
  }
  protected override async loadPivotChildCounts(o: data.PivotCountsOptions<Sale>): Promise<unknown> {
    this.asked.push('counts');
    const r = pivotCounts(sales, o, this.evaluateContext);
    return { counts: o.paths.map((path) => ({ path, count: r.childCount(path) })) };
  }
  protected override async loadPivotCellGroups(o: data.PivotCellsOptions<Sale>): Promise<unknown> {
    this.asked.push('cells');
    const r = pivotCells(sales, o, this.evaluateContext);
    return JSON.parse(JSON.stringify(o.rowPaths.flatMap((rows) => o.columnPaths.map((columns) => ({ rows, columns, count: r.count(rows, columns), values: r.values(rows, columns) ?? [] })))));
  }
}

describe('pivot windows on adapters', () => {
  it('groups in memory where the backend does not compute them, and checks the options', async () => {
    const a = new ArrayAdapter<Sale, number>({ data: sales, key: 'id', fields: { day: 'date' }, locale: 'en-US' });
    const r = await a.loadPivotMembers({ levels: [year, quarter], slices: [{ parent: [2024] }], measures: [count] });
    expect(r.slices[0].members.map((m) => [m.key, m.values])).toEqual([
      [1, [3]],
      [3, [1]],
    ]);
    expect((await a.loadPivotCounts({ levels: [year, quarter], paths: [[2023]] })).childCount([2023])).toBe(2);
    expect((await a.loadPivotCells({ rows: [year], columns: [], measures: [sum], rowPaths: [[2023]], columnPaths: [[]] })).values([2023], [])).toEqual([130]);
    const bad: unknown[] = [
      { levels: [], slices: [{ parent: [] }] },
      { levels: [region], slices: [] },
      { levels: [region], slices: [{ parent: ['North'] }] },
      { levels: [region, city], slices: [{ parent: [] }, { parent: ['North'] }] },
      { levels: [region], slices: [{ parent: [], take: -1 }] },
      { levels: [region], slices: [{ parent: [] }], measures: [sum], sortBySummary: { measure: 1 } },
      { levels: [region], slices: [{ parent: [] }], measures: [sum], sortBySummary: { measure: 0, path: ['x'] } },
    ];
    for (const options of bad) await expect(a.loadPivotMembers(options as data.PivotMembersOptions<Sale>)).rejects.toMatchObject({ code: 'MJD302' });
    await expect(a.loadPivotCounts({ levels: [region], paths: [['North']] })).rejects.toMatchObject({ code: 'MJD302' });
    await expect(a.loadPivotCells({ rows: [region], columns: [], measures: [count], rowPaths: [['North', 'Oslo']], columnPaths: [[]] })).rejects.toMatchObject({ code: 'MJD302' });
  });

  it('reads what a backend answers the way memory gives it: keys of dates and intervals, values, numbers', async () => {
    const server = new Server();
    const members = await server.loadPivotMembers({ levels: [{ field: 'day', interval: 'date' }], slices: [{ parent: [], take: 2 }], measures: [sum] });
    expect(members.slices[0].members.map((m) => [m.key, m.values])).toEqual([
      [new Date(2023, 4, 5), [20]],
      [new Date(2023, 10, 2), [100]],
    ]);
    const counts = await server.loadPivotCounts({ levels: [{ field: 'day', interval: 'date' }, region], paths: [[new Date(2023, 4, 5)]] });
    expect(counts.childCount([new Date(2023, 4, 5)])).toBe(1);
    const cells = await server.loadPivotCells({ rows: [region], columns: [year], measures: [sum], rowPaths: [['NORTH']], columnPaths: [[2024], []] });
    expect([cells.values(['north'], [2024]), cells.values(['North'], [])]).toEqual([[50], [150]]);
    expect(server.asked).toEqual(['members', 'counts', 'cells']);
  });

  it('fails with an answer that is none', async () => {
    class Broken extends Server {
      protected override async loadPivotMemberSlices(): Promise<unknown> {
        return { slices: [] };
      }
      protected override async loadPivotCellGroups(): Promise<unknown> {
        return { groups: 1 };
      }
    }
    const broken = new Broken();
    await expect(broken.loadPivotMembers({ levels: [region], slices: [{ parent: [] }] })).rejects.toMatchObject({ code: 'MJD104' });
    await expect(broken.loadPivotCells({ rows: [region], columns: [], measures: [count], rowPaths: [[]], columnPaths: [[]] })).rejects.toMatchObject({ code: 'MJD104' });
  });

  it('runs on the query of a data source', async () => {
    const source = new data.DataSource<Sale, number>({ adapter: new ArrayAdapter<Sale, number>({ data: sales, key: 'id', fields: { day: 'date' } }), filter: where('amount', '>=', 50) });
    const r = await source.loadPivotMembers({ levels: [region], slices: [{ parent: [] }], measures: [count] });
    expect(r.slices[0].members.map((m) => [m.key, m.values[0]])).toEqual([
      ['East', 1],
      ['North', 2],
    ]);
  });
});
