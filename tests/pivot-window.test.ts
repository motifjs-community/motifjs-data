import { describe, expect, it } from 'vitest';
import { data } from '../src';
const { allEmpty, ArrayAdapter, pivotCells, pivotCounts, pivotMembers, queryPivot, where } = data;

type Sale = { id: number; region: string | null; city: string; day: string; amount: number | null; units: number; rating: number | null };

const sales: Sale[] = [
  { id: 1, region: 'North', city: 'Oslo', day: '2023-11-02', amount: 100, units: 1, rating: 4 },
  { id: 2, region: 'north', city: 'Bergen', day: '2024-01-15', amount: 50, units: 2, rating: null },
  { id: 3, region: 'South', city: 'Rome', day: '2024-02-01', amount: 30, units: 3, rating: null },
  { id: 4, region: 'South', city: 'Rome', day: '2024-07-04', amount: null, units: 4, rating: null },
  { id: 5, region: null, city: 'Nowhere', day: '2023-05-05', amount: 20, units: 5, rating: null },
  { id: 6, region: 'South', city: 'Milan', day: '2023-12-31', amount: 10, units: 6, rating: 3 },
  { id: 7, region: 'East', city: 'Kyiv', day: '2024-03-03', amount: 70, units: 7, rating: null },
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
    // South has Milan and Rome, Milan only in 2023.
    const counted = pivotMembers(sales, { filter, keep, levels: [region, city], slices: [{ parent: [] }], childCounts: true }, ctx);
    expect(counted.slices[0].members.map((m) => [m.key, m.childCount])).toEqual([
      ['north', 1],
      ['South', 1],
    ]);
    expect(pivotCells(sales, { filter, keep, rows: [region], columns: [], measures: [count], rowPaths: [[]], columnPaths: [[]] }, ctx).count([], [])).toBe(3);
  });
});

describe('pivot windows without empty members', () => {
  // Ratings: North 4 (Oslo 4, Bergen none), South 3 (Milan 3, Rome none), East and the empty region none.
  const avg = { type: 'avg', field: 'rating' } as const;
  const min = { type: 'min', field: 'rating' } as const;

  it('leaves out the members whose measures are all empty, of the part and of the number of all', () => {
    const top = (measures: data.PivotMeasure<Sale>[], skip?: number, take?: number) =>
      keysOf(pivotMembers(sales, { levels: [region, city], slices: [{ parent: [], skip, take }], measures, nonEmpty: true }, ctx));
    expect(top([avg])).toEqual([[2, ['North', 'South']]]);
    expect(top([avg, min], 1, 1)).toEqual([[2, ['South']]]);
    const children = pivotMembers(sales, { levels: [region, city], slices: [{ parent: ['north'] }, { parent: ['South'] }, { parent: ['East'] }], measures: [min], nonEmpty: true }, ctx);
    expect(keysOf(children)).toEqual([
      [1, ['Oslo']],
      [1, ['Milan']],
      [0, []],
    ]);
    expect(children.slices[0].members.map((m) => [m.path, m.count, m.values])).toEqual([[['north', 'Oslo'], 1, [4]]]);
    // The empty region is left out as any other is: with a value of its own it stays.
    expect(top([{ type: 'max', field: 'amount' }])).toEqual([[4, ['East', 'North', 'South', null]]]);
    expect(keysOf(pivotMembers(sales, { levels: [region, city], slices: [{ parent: [null] }], measures: [avg], nonEmpty: true }, ctx))).toEqual([[0, []]]);
  });

  it('counts, finds and orders only the members not left out', () => {
    const counted = (nonEmpty: boolean) =>
      pivotMembers(sales, { levels: [region, city, year], slices: [{ parent: [] }], measures: [avg], nonEmpty, childCounts: true }, ctx).slices[0].members.map((m) => [m.key, m.childCount]);
    expect(counted(false)).toEqual([
      ['East', 1],
      ['North', 2],
      ['South', 2],
      [null, 1],
    ]);
    expect(counted(true)).toEqual([
      ['North', 1],
      ['South', 1],
    ]);
    const milan = pivotMembers(sales, { levels: [region, city, year], slices: [{ parent: ['South'] }], measures: [avg], nonEmpty: true, childCounts: true }, ctx);
    expect(milan.slices[0].members.map((m) => [m.path, m.childCount])).toEqual([[['South', 'Milan'], 1]]);

    const find = [['North', 'Bergen'], ['north', 'oslo'], ['South', 'Milan'], [null, 'Nowhere']];
    const places = (nonEmpty: boolean) => pivotMembers(sales, { levels: [region, city], slices: [{ parent: ['North'], take: 0 }], measures: [avg], nonEmpty, find }, ctx).found;
    expect(places(false)).toEqual([0, 1, 0, 0]);
    expect(places(true)).toEqual([-1, 0, 0, -1]);

    const sorted = (nonEmpty: boolean) => keysOf(pivotMembers(sales, { levels: [region], slices: [{ parent: [] }], measures: [avg], sortBySummary: { measure: 0 }, nonEmpty }, ctx));
    expect(sorted(false)).toEqual([[4, ['South', 'North', 'East', null]]]);
    expect(sorted(true)).toEqual([[2, ['South', 'North']]]);

    const paths = [[], ['north'], ['South'], ['East'], [null]];
    const counts = pivotCounts(sales, { levels: [region, city], paths, measures: [avg], nonEmpty: true }, ctx);
    expect(paths.map((path) => counts.childCount(path))).toEqual([2, 1, 1, 0, 0]);
    // 2023: the second quarter has no rating, the fourth has; 2024 has none.
    const quarters = pivotCounts(sales, { levels: [year, quarter], paths: [[2023], [2024]], measures: [min], nonEmpty: true }, ctx);
    expect([quarters.childCount([2023]), quarters.childCount([2024])]).toEqual([1, 0]);
  });

  it('leaves nothing out with a measure that always has a value, or without measures', () => {
    const lists: (data.PivotMeasure<Sale>[] | undefined)[] = [[avg, sum], [count], [{ type: 'countDistinct', field: 'rating' }], [{ type: 'sum', field: 'rating' }], [], undefined];
    for (const measures of lists) {
      const r = pivotMembers(sales, { levels: [region, city], slices: [{ parent: [] }], measures, nonEmpty: true, childCounts: true }, ctx);
      expect(r.slices[0].members.map((m) => [m.key, m.childCount])).toEqual([
        ['East', 1],
        ['North', 2],
        ['South', 2],
        [null, 1],
      ]);
      expect(pivotCounts(sales, { levels: [region, city], paths: [['South']], measures, nonEmpty: true }, ctx).childCount(['South'])).toBe(2);
    }
  });

  it('gives the members of queryPivot whose measures are not all empty, on every level', () => {
    const levels = [region, city, quarter];
    const lists: data.PivotMeasure<Sale>[][] = [[avg], [min, { type: 'max', field: 'amount' }]];
    for (const measures of lists) {
      const whole = queryPivot(sales, { rows: levels, measures }, ctx);
      const kept = (m: data.PivotMember) => (m.children ?? []).filter((c) => !allEmpty(whole.values(c, whole.columns) ?? []));
      const walk = (m: data.PivotMember) => {
        if (m.path.length >= levels.length) return;
        const r = pivotMembers(sales, { levels, slices: [{ parent: m.path }], measures, nonEmpty: true, childCounts: true }, ctx);
        const expected = kept(m).map((c) => [c.key, whole.values(c, whole.columns), c.path.length < levels.length ? kept(c).length : 0]);
        expect([m.path, r.slices[0].members.map((c) => [c.key, c.values, c.childCount])]).toEqual([m.path, expected]);
        expect(pivotCounts(sales, { levels, paths: [m.path], measures, nonEmpty: true }, ctx).childCount(m.path)).toBe(kept(m).length);
        m.children?.forEach(walk);
      };
      walk(whole.rows);
    }
    expect([allEmpty([]), allEmpty([null, undefined, '', NaN]), allEmpty([null, 0])]).toEqual([false, true, false]);
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
      { levels: [region], slices: [{ parent: [] }], nonEmpty: 'yes' },
    ];
    for (const options of bad) await expect(a.loadPivotMembers(options as data.PivotMembersOptions<Sale>)).rejects.toMatchObject({ code: 'MJD302' });
    await expect(a.loadPivotCounts({ levels: [region], paths: [['North']] })).rejects.toMatchObject({ code: 'MJD302' });
    for (const more of [{ nonEmpty: 1 }, { measures: [{ type: 'median', field: 'rating' }], nonEmpty: true }]) {
      await expect(a.loadPivotCounts({ levels: [region], paths: [[]], ...more } as unknown as data.PivotCountsOptions<Sale>)).rejects.toMatchObject({ code: 'MJD302' });
    }
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

  it('leaves out empty members on the backend, or in memory where a measure needs it', async () => {
    const server = new Server();
    const avg = { type: 'avg', field: 'rating' } as const;
    const best: data.PivotCustomMeasure<Sale, number | null> = {
      type: 'custom',
      field: 'rating',
      start: () => null,
      add: (most, value) => (typeof value === 'number' && (most === null || value > most) ? value : most),
      result: (most) => most,
    };
    const members = await server.loadPivotMembers({ levels: [region, city], slices: [{ parent: [] }], measures: [avg], nonEmpty: true, childCounts: true });
    expect(members.slices[0].members.map((m) => [m.key, m.childCount])).toEqual([
      ['North', 1],
      ['South', 1],
    ]);
    const counts = await server.loadPivotCounts({ levels: [region, city], paths: [[], ['South']], measures: [avg], nonEmpty: true });
    expect([counts.childCount([]), counts.childCount(['South'])]).toEqual([2, 1]);
    expect(server.asked).toEqual(['members', 'counts']);
    // A custom measure needs memory: the rows are grouped here.
    const custom = await server.loadPivotCounts({ levels: [region, city], paths: [[], ['South']], measures: [best], nonEmpty: true });
    expect([custom.childCount([]), custom.childCount(['South']), server.asked.length]).toEqual([2, 1, 2]);
    // Without nonEmpty the measures of a count are not read.
    await server.loadPivotCounts({ levels: [region, city], paths: [[]], measures: [best] });
    expect(server.asked).toEqual(['members', 'counts', 'counts']);
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
