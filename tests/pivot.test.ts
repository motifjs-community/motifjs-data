import { describe, expect, it } from 'vitest';
import { data } from '../src';
const { ArrayAdapter, DataSource, intervalValue, pivotDepths, pivotGroups, pivotResult, queryPivot, readPivotGroup, where } = data;

type Sale = { id: number; region: string | null; city: string; day: string; amount: number | null; units: number };

const sales: Sale[] = [
  { id: 1, region: 'North', city: 'Oslo', day: '2023-11-02', amount: 100, units: 1 },
  { id: 2, region: 'north', city: 'Bergen', day: '2024-01-15', amount: 50, units: 2 },
  { id: 3, region: 'South', city: 'Rome', day: '2024-02-01', amount: 30, units: 3 },
  { id: 4, region: 'South', city: 'Rome', day: '2024-07-04', amount: null, units: 4 },
  { id: 5, region: null, city: 'Nowhere', day: '2023-05-05', amount: 20, units: 5 },
  { id: 6, region: 'South', city: 'Milan', day: '2023-12-31', amount: 10, units: 6 },
];
const ctx: data.EvaluateContext = { locale: 'en-US', fields: { day: 'date' } };
const sum = { type: 'sum', field: 'amount' } as const;
const count = { type: 'count' } as const;
const avg = { type: 'avg', field: 'amount' } as const;

const keys = (member: data.PivotMember | undefined) => member?.children?.map((m) => m.key);
const child = (member: data.PivotMember, key: unknown) => member.children!.find((m) => m.key === key)!;

describe('pivot in memory', () => {
  it('crosses the members of both axes, with totals computed from the rows', () => {
    const p = queryPivot(sales, { rows: [{ field: 'region' }], columns: [{ field: 'day', interval: 'year' }], measures: [sum, count, avg] }, ctx);
    // Text groups without case, the first row naming the member; empty values last.
    expect(keys(p.rows)).toEqual(['North', 'South', null]);
    expect(p.rows.children!.map((m) => [m.path, m.count])).toEqual([[['North'], 2], [['South'], 3], [[null], 1]]);
    expect([keys(p.columns), p.columns.children!.map((m) => m.count), p.rows.count]).toEqual([[2023, 2024], [3, 3], 6]);
    const [north, south, empty] = p.rows.children!;
    const [y2023, y2024] = p.columns.children!;
    expect(p.values(north, y2023)).toEqual([100, 1, 100]);
    expect(p.values(south, y2024)).toEqual([30, 2, 30]);
    expect(p.values(empty, y2024)).toBeUndefined();
    // The average of a total is that of its rows, not of the cells.
    expect(p.values(south, p.columns)).toEqual([40, 3, 20]);
    expect(p.values(p.rows, y2023)).toEqual([130, 3, 130 / 3]);
    expect(p.values(p.rows, p.columns)).toEqual([210, 6, 42]);
    expect(p.rows.key).toBeUndefined();
    expect(p.rows.path).toEqual([]);

    const down = queryPivot(sales, { rows: [{ field: 'region', dir: 'desc' }], columns: [{ field: 'day', interval: 'year', dir: 'desc' }] }, ctx);
    expect([keys(down.rows), keys(down.columns)]).toEqual([['South', 'North', null], [2024, 2023]]);
  });

  it('computes the children of the expanded members only', () => {
    const levels = { rows: [{ field: 'region' }, { field: 'city' }], measures: [count] };
    const all = queryPivot(sales, levels, ctx);
    expect([keys(child(all.rows, 'North')), keys(child(all.rows, 'South')), keys(child(all.rows, null))]).toEqual([['Bergen', 'Oslo'], ['Milan', 'Rome'], ['Nowhere']]);
    expect(all.values(child(child(all.rows, 'South'), 'Rome'), all.columns)).toEqual([2]);

    // Memory finds a member by its value the way it groups: 'south' is South.
    const south = queryPivot(sales, { ...levels, expandedRows: [['south']] }, ctx);
    expect([keys(child(south.rows, 'North')), keys(child(south.rows, 'South'))]).toEqual([undefined, ['Milan', 'Rome']]);
    expect(pivotGroups(sales, { ...levels, expandedRows: [['South']] }, ctx)).toHaveLength(6);

    const top = queryPivot(sales, { ...levels, expandedRows: [] }, ctx);
    expect(top.rows.children!.every((m) => m.children === undefined)).toBe(true);
  });

  it('shows a member only when every member above it is expanded', () => {
    const rows = [{ field: 'region' }, { field: 'city' }, { field: 'id' }];
    const p = queryPivot(sales, { rows, measures: [count], expandedRows: [['North', 'Oslo'], ['South'], ['South', 'Rome']] }, ctx);
    expect(keys(child(p.rows, 'North'))).toBeUndefined();
    expect(keys(child(child(p.rows, 'South'), 'Rome'))).toEqual([3, 4]);
    expect(keys(child(child(p.rows, 'South'), 'Milan'))).toBeUndefined();
  });

  it('groups by date parts and by ranges of numbers', () => {
    expect(['year', 'quarter', 'month', 'day', 'dayOfWeek'].map((i) => intervalValue('2024-08-15', i as data.PivotInterval))).toEqual([2024, 3, 8, 15, 4]);
    expect(intervalValue(new Date(2024, 7, 15, 22, 30), 'date')).toEqual(new Date(2024, 7, 15));
    expect([intervalValue(null, 'year'), intervalValue('not a date', 'month'), intervalValue('abc', 10)]).toEqual([null, null, null]);
    // A value on a boundary starts its range, decimals included.
    expect([250, 200, -150, 0.3, 0.29, 0.7, '42'].map((n, i) => intervalValue(n, [100, 100, 100, 0.1, 0.01, 0.1, 10][i]))).toEqual([200, 200, -200, 0.3, 0.29, 0.7, 40]);

    const p = queryPivot(sales, { columns: [{ field: 'day', interval: 'year' }, { field: 'day', interval: 'quarter' }], rows: [{ field: 'amount', interval: 50 }], measures: [count] }, ctx);
    expect(p.columns.children!.map((m) => [m.key, keys(m)])).toEqual([[2023, [2, 4]], [2024, [1, 3]]]);
    expect(p.rows.children!.map((m) => [m.key, m.count])).toEqual([[0, 3], [50, 1], [100, 1], [null, 1]]);
  });

  it('keeps rows by their members on levels of their own: date parts, ranges, computed values, empty ones', () => {
    const regions = (keep: data.PivotKeep<Sale>[]) => queryPivot(sales, { rows: [{ field: 'region' }], measures: [count], keep }, ctx).rows.children!.map((m) => [m.key, m.count]);
    // 2024 whole, and the last quarter of 2023: a path names a member from the first interval down.
    expect(regions([{ field: 'day', intervals: ['year', 'quarter'], paths: [[2024], [2023, 4]] }])).toEqual([
      ['North', 2],
      ['South', 3],
    ]);
    // January and February of any year, left out.
    expect(regions([{ field: 'day', intervals: ['month'], paths: [[1], [2]], type: 'exclude' }])).toEqual([
      ['North', 1],
      ['South', 2],
      [null, 1],
    ]);
    // Ranges of 50 from 0, and the empty amount.
    expect(regions([{ field: 'amount', intervals: [50], paths: [[0], [null]] }])).toEqual([
      ['South', 3],
      [null, 1],
    ]);
    expect(regions([{ field: 'big', value: (s) => (s.amount ?? 0) > 40, paths: [[true]] }])).toEqual([['North', 2]]);
    // Text is told apart without case; every entry applies.
    expect(regions([{ field: 'region', paths: [['NORTH']] }])).toEqual([['North', 2]]);
    expect(regions([{ field: 'region', paths: [[null]], type: 'exclude' }, { field: 'city', paths: [['Rome']] }])).toEqual([['South', 2]]);
    expect(regions([{ field: 'region', paths: [] }])).toEqual([]);
  });

  it('counts distinct values, finds the smallest and largest, and runs measures and levels of their own', () => {
    const median = {
      type: 'custom' as const,
      field: 'units',
      start: (): number[] => [],
      add: (list: number[], value: unknown) => [...list, value as number],
      result: (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)],
    };
    const p = queryPivot(
      sales,
      {
        rows: [{ field: 'size', value: (s: Sale) => (s.amount === null ? null : s.amount >= 50 ? 'big' : 'small') }],
        measures: [{ type: 'countDistinct', field: 'city' }, { type: 'min', field: 'day' }, { type: 'max', field: 'day' }, median, { type: 'sum', field: 'tenfold', value: (s: Sale) => s.units * 10 }],
      },
      ctx,
    );
    expect(keys(p.rows)).toEqual(['big', 'small', null]);
    expect(p.values(child(p.rows, 'small'), p.columns)).toEqual([3, '2023-05-05', '2024-02-01', 5, 140]);
    expect(p.values(p.rows, p.columns)).toEqual([5, '2023-05-05', '2024-07-04', 4, 210]);
    expect(data.summarize(sales, [{ type: 'countDistinct', field: 'region' }], { locale: 'en-US' })).toEqual([2]);
  });

  it('builds the result from groups a backend sent, keys and values read the way memory gives them', () => {
    const options: data.PivotLoadOptions = { rows: [{ field: 'day', interval: 'year' }], columns: [{ field: 'day' }], measures: [sum, { type: 'countDistinct', field: 'city' }, avg, { type: 'max', field: 'day' }] };
    const fields = { day: 'date' as const };
    const sent = [
      { rows: [], columns: [], count: '2', values: ['80', '2', '40.0', '2024-02-01'] },
      { rows: ['2024'], columns: [], count: 2, values: [80, 2, 40, '2024-02-01'] },
      { rows: [], columns: ['2024-01-15'], count: 1, values: [50, 1, 50, '2024-01-15'] },
      { rows: [], columns: ['2024-02-01'], count: 1, values: [30, 1, null, '2024-02-01'] },
      { rows: ['2024'], columns: ['2024-01-15'], count: 1, values: [50, 1, 50, '2024-01-15'] },
      // A member that is not there.
      { rows: ['2031'], columns: ['2024-01-15'], count: 1, values: [1, 1, 1, null] },
    ].map((g) => readPivotGroup(g, options, fields));
    expect(sent[0]).toEqual({ rows: [], columns: [], count: 2, values: [80, 2, 40, '2024-02-01'] });
    expect(sent[2].columns).toEqual([new Date(2024, 0, 15)]);
    const p = pivotResult(sent, options, { fields });
    expect([keys(p.rows), keys(p.columns)]).toEqual([[2024], [new Date(2024, 0, 15), new Date(2024, 1, 1)]]);
    expect(p.values(p.rows.children![0], p.columns.children![0])).toEqual([50, 1, 50, '2024-01-15']);
    expect(p.values(p.rows, p.columns.children![1])).toEqual([30, 1, null, '2024-02-01']);
    expect(() => readPivotGroup({ rows: 'x' }, options)).toThrow(TypeError);
  });

  it('tells a backend the depths to compute and the members they hold', () => {
    const three = [{ field: 'a' }, { field: 'b' }, { field: 'c' }];
    expect(pivotDepths(three, [['A'], ['A', 'x'], ['A', 'x'], ['B', 'y'], ['C']])).toEqual([
      { depth: 0, parents: null },
      { depth: 1, parents: null },
      { depth: 2, parents: [['A'], ['C']] },
      { depth: 3, parents: [['A', 'x']] },
    ]);
    expect(pivotDepths(three, true).map((d) => [d.depth, d.parents])).toEqual([[0, null], [1, null], [2, null], [3, null]]);
    expect(pivotDepths(three, []).map((d) => d.depth)).toEqual([0, 1]);
    expect(pivotDepths([], undefined)).toEqual([{ depth: 0, parents: null }]);
  });

  it('groups 100 000 rows on two levels each way with three measures quickly', () => {
    const regions = ['North', 'South', 'East', 'West'];
    const rows = Array.from({ length: 100_000 }, (_, i) => ({
      region: regions[i % 4],
      city: `City ${i % 40}`,
      day: new Date(2020 + (i % 5), i % 12, 1 + (i % 28)),
      amount: (i % 100) + 0.5,
    }));
    const started = performance.now();
    const p = queryPivot(
      rows,
      {
        rows: [{ field: 'region' }, { field: 'city' }],
        columns: [{ field: 'day', interval: 'year' }, { field: 'day', interval: 'quarter' }],
        measures: [sum, count, avg],
      },
      { locale: 'en-US' },
    );
    const ms = performance.now() - started;
    expect(p.rows.count).toBe(100_000);
    expect(p.columns.children).toHaveLength(5);
    expect(ms).toBeLessThan(1500);
  });
});

describe('loadPivot', () => {
  const adapter = () => new ArrayAdapter<Sale, number>({ data: sales, key: 'id', locale: 'en-US', fields: { day: 'date' } });

  it('groups the rows its filter passes in memory when the backend computes no pivots', async () => {
    const a = adapter();
    expect(a.capabilities.pivot).toBeUndefined();
    const p = await a.loadPivot({ filter: where('amount', '>', 15), rows: [{ field: 'region' }], measures: [sum] });
    expect(p.rows.children!.map((m) => [m.key, m.count, p.values(m, p.columns)])).toEqual([['North', 2, [150]], ['South', 1, [30]], [null, 1, [20]]]);
  });

  it('rejects options it cannot read, reporting each failure once', async () => {
    const a = adapter();
    const errors: string[] = [];
    a.onError((e) => errors.push(e.error.code));
    const bad: data.PivotLoadOptions<Sale>[] = [
      { rows: [{ field: 1 as unknown as string }] },
      { columns: [{ field: 'day', interval: 'week' as data.PivotInterval }] },
      { rows: [{ field: 'amount', interval: 0 }] },
      { measures: [{ type: 'median' as data.SummaryType, field: 'amount' }] },
      { measures: [{ type: 'sum' }] },
      { measures: [{ type: 'custom', start: () => 0 } as unknown as data.PivotMeasure<Sale>] },
      { expandedRows: 'all' as unknown as true },
    ];
    for (const options of bad) await expect(a.loadPivot(options)).rejects.toMatchObject({ code: 'MJD302' });
    expect(errors).toEqual(bad.map(() => 'MJD302'));
  });

  it('keeps members in memory, and rejects a keep it cannot read', async () => {
    const adapter = new ArrayAdapter<Sale, number>({ data: sales, key: 'id', fields: { day: 'date' }, locale: 'en-US' });
    const p = await adapter.loadPivot({ rows: [{ field: 'region' }], measures: [count], keep: [{ field: 'day', intervals: ['year'], paths: [[2024]] }] });
    // A member's key is its value in the first row kept.
    expect(p.rows.children!.map((m) => [m.key, m.count])).toEqual([
      ['north', 1],
      ['South', 2],
    ]);
    await expect(adapter.loadPivot({ keep: [{ field: 'day', intervals: ['week' as data.PivotInterval], paths: [] }] })).rejects.toMatchObject({ code: 'MJD302' });
    await expect(adapter.loadPivot({ keep: [{ field: 'day', paths: [2024] as never }] })).rejects.toMatchObject({ code: 'MJD302' });
  });

  it('runs on the query of a data source', async () => {
    // Oslo and Bergen go by the source's filter, Milan by its search, Nowhere by the pivot's filter.
    const source = new DataSource<Sale, number>({ adapter: adapter(), filter: where('units', '>', 2), searchFields: ['city'] });
    await source.search('e');
    const p = await source.loadPivot({ filter: where('units', '<', 5), rows: [{ field: 'city' }], measures: [count] });
    expect(keys(p.rows)).toEqual(['Rome']);
    expect(p.values(child(p.rows, 'Rome'), p.columns)).toEqual([2]);
  });
});
