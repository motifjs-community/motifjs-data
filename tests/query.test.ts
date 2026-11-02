import { describe, expect, it } from 'vitest';
import { data } from '../src';
const { and, createRowFilter, none, not, or, queryArray, sortRows, where } = data;

type Row = { id: number; name: string; city: string | null; amount: number | null; day: string; at: Date; tags?: { main: string } };

const rows: Row[] = [
  { id: 1, name: 'İsmail Işık', city: 'İstanbul', amount: 120, day: '2024-01-05', at: new Date(2024, 0, 5, 10), tags: { main: 'a' } },
  { id: 2, name: 'ismet ılgaz', city: 'izmir', amount: 80, day: '2024-02-10', at: new Date(2024, 1, 10, 9) },
  { id: 3, name: 'Ada Lovelace', city: null, amount: null, day: '2023-12-31', at: new Date(2023, 11, 31, 23) },
  { id: 4, name: 'Alan', city: '', amount: 120, day: '2024-01-05', at: new Date(2024, 0, 5, 18), tags: { main: 'b' } },
  { id: 5, name: 'item 10', city: 'Ankara', amount: 5, day: '2024-03-01', at: new Date(2024, 2, 1) },
  { id: 6, name: 'item 9', city: 'Ankara', amount: 5, day: '2024-03-01', at: new Date(2024, 2, 1) },
];

const ids = (f: data.FilterExpression | null, fields = {}) => rows.filter(createRowFilter(f, { locale: 'tr', fields })).map((r) => r.id);

describe('filter', () => {
  it('compares text without case in the locale (Turkish İ/ı)', () => {
    expect(ids(where('city', '=', 'istanbul'))).toEqual([1]);
    expect(ids(where('name', 'contains', 'IŞIK'))).toEqual([1]);
    expect(ids(where('name', 'startswith', 'İS'))).toEqual([1, 2]);
    expect(ids(where('name', 'endswith', 'ILGAZ'))).toEqual([2]);
    expect(ids(where('name', 'contains', 'ada', true))).toEqual([]);
    expect(ids(where('name', 'notcontains', 'item'))).toEqual([1, 2, 3, 4]);
  });

  it('compares numbers, ranges and lists', () => {
    expect(ids(where('amount', '>=', 100))).toEqual([1, 4]);
    expect(ids(where('amount', '<', 100))).toEqual([2, 5, 6]);
    expect(ids(where('amount', 'between', [5, 80]))).toEqual([2, 5, 6]);
    expect(ids(where('amount', 'between', [100, null]))).toEqual([1, 4]);
    expect(ids(where('id', 'in', [2, 4, 9]))).toEqual([2, 4]);
    expect(ids(where('id', 'notin', [2, 4]))).toEqual([1, 3, 5, 6]);
  });

  it('treats null, undefined, empty and blank text as blank', () => {
    expect(ids(where('city', 'isblank'))).toEqual([3, 4]);
    expect(ids(where('city', 'isnotblank'))).toEqual([1, 2, 5, 6]);
    expect(ids(where('amount', '=', null))).toEqual([3]);
    expect(ids(where('amount', '<>', null))).toEqual([1, 2, 4, 5, 6]);
    expect(ids(where('name', 'contains', ''))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('compares declared dates by day and date-times by moment', () => {
    expect(ids(where('day', '=', new Date(2024, 0, 5, 15)), { day: 'date' })).toEqual([1, 4]);
    expect(ids(where('at', '=', '2024-01-05'), { at: 'date' })).toEqual([1, 4]);
    expect(ids(where('at', '>', new Date(2024, 0, 5, 12)))).toEqual([2, 4, 5, 6]);
    expect(ids(where('day', 'between', ['2024-01-01', '2024-02-28']), { day: 'date' })).toEqual([1, 2, 4]);
  });

  it('joins with and, or, not and reads dotted paths', () => {
    expect(ids(and(where('amount', '=', 120), where('tags.main', '=', 'b')))).toEqual([4]);
    expect(ids(or(where('id', '=', 1), where('city', '=', 'ANKARA')))).toEqual([1, 5, 6]);
    expect(ids(not(where('city', 'isblank'))!)).toEqual([1, 2, 5, 6]);
    expect(and(null, where('id', '=', 1), undefined)).toEqual({ field: 'id', op: '=', value: 1 });
    expect(and()).toBeNull();
  });

  it('none keeps no row, alone, under and, and as one side of or', () => {
    expect(ids(none())).toEqual([]);
    expect(ids(and(where('id', '>', 0), none()))).toEqual([]);
    expect(ids(or(none(), where('id', '=', 2)))).toEqual([2]);
    expect(ids(not(none()))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects unknown operators and bad values', () => {
    expect(() => createRowFilter({ field: 'id', op: 'like' as never })).toThrow(/unknown operator "like"/);
    expect(() => createRowFilter(where('id', 'between', 3))).toThrow(/needs \[from, to\]/);
    expect(() => createRowFilter({ and: [{ nope: 1 }] } as never)).toThrow(/filter.and\[0\]/);
  });

  it('tells a filter expression from other values', () => {
    expect(data.isFilterExpression(where('id', '<', 3))).toBe(true);
    expect(data.isFilterExpression(or(where('id', '<', 3), not(where('city', 'isblank'))))).toBe(true);
    expect(data.isFilterExpression(none())).toBe(true);
    for (const other of [null, 3, 'Ankara', new Date(), [], { field: 'id', op: 'like' }, { and: [1] }, { value: 3 }]) {
      expect(data.isFilterExpression(other), String(other)).toBe(false);
    }
  });
});

describe('sort', () => {
  it('sorts text in the locale with numbers by value, empty values last both ways, stable', () => {
    const by = (field: string, dir: 'asc' | 'desc') => sortRows(rows, [{ field, dir }], { locale: 'tr' }).map((r) => r.id);
    expect(by('name', 'asc')).toEqual([3, 4, 1, 2, 6, 5]);
    expect(by('city', 'asc')).toEqual([5, 6, 1, 2, 3, 4]);
    expect(by('city', 'desc')).toEqual([2, 1, 5, 6, 3, 4]);
    expect(by('amount', 'desc')).toEqual([1, 4, 2, 5, 6, 3]);
    expect(sortRows(rows, [{ field: 'amount', dir: 'asc' }, { field: 'id', dir: 'desc' }]).map((r) => r.id)).toEqual([6, 5, 2, 4, 1, 3]);
  });
});

describe('queryArray', () => {
  it('filters, sorts, counts, pages and selects; keeps row identity without select', () => {
    const r = queryArray(rows, { filter: where('amount', '>', 0), sort: [{ field: 'amount', dir: 'asc' }], skip: 1, take: 2, count: true });
    expect(r.total).toBe(5);
    expect(r.rows.map((x) => x.id)).toEqual([6, 2]);
    expect(r.rows[0]).toBe(rows[5]);
    const s = queryArray(rows, { take: 1, select: ['id', 'tags.main'] });
    expect(s.rows).toEqual([{ id: 1, tags: { main: 'a' } }]);
    expect(queryArray(rows).rows).not.toBe(rows);
  });

  it('filters and sorts 100,000 rows quickly', () => {
    const big = Array.from({ length: 100_000 }, (_, i) => ({ id: i, name: `Name ${(i * 7919) % 100_000}`, amount: (i * 31) % 1000 }));
    const t = performance.now();
    const r = queryArray(big, { filter: where('amount', '>', 500), sort: [{ field: 'name', dir: 'asc' }], take: 50, count: true }, { locale: 'tr' });
    const ms = performance.now() - t;
    expect(r.total).toBe(49_900);
    expect(r.rows).toHaveLength(50);
    expect(ms).toBeLessThan(1500);
  });
});

describe('grouping and summaries', () => {
  type Sale = { id: number; country: string; city: string | null; amount: number | null; day: string };
  const sales: Sale[] = [
    { id: 1, country: 'TR', city: 'İstanbul', amount: 10, day: '2024-01-03' },
    { id: 2, country: 'TR', city: 'istanbul', amount: 30, day: '2024-01-01' },
    { id: 3, country: 'TR', city: 'Ankara', amount: 20, day: '2024-02-01' },
    { id: 4, country: 'DE', city: 'Berlin', amount: 5, day: '2023-12-31' },
    { id: 5, country: 'DE', city: null, amount: 7, day: '2024-03-01' },
    { id: 6, country: 'NO', city: 'Oslo', amount: null, day: '2024-01-15' },
  ];
  const sum = { type: 'sum', field: 'amount' } as const;
  const count = { type: 'count' } as const;

  it('groups in levels, groups and rows in order, text without case, empty values last', () => {
    const result = queryArray(
      sales,
      { group: [{ field: 'country', dir: 'desc' }, { field: 'city' }], sort: [{ field: 'amount', dir: 'desc' }], groupSummary: [sum, count], count: true },
      { locale: 'tr' },
    );
    const shape = (groups: data.RowGroup<Sale>[]): unknown =>
      groups.map((g) => [g.key, g.count, g.summary, g.groups ? shape(g.groups) : g.items!.map((r) => r.id)]);
    expect(shape(result.groups!)).toEqual([
      ['TR', 3, [60, 3], [['Ankara', 1, [20, 1], [3]], ['istanbul', 2, [40, 2], [2, 1]]]],
      ['NO', 1, [0, 1], [['Oslo', 1, [0, 1], [6]]]],
      ['DE', 2, [12, 2], [['Berlin', 1, [5, 1], [4]], [null, 1, [7, 1], [5]]]],
    ]);
    expect(result.rows.map((r) => r.id)).toEqual([3, 2, 1, 6, 4, 5]);
    expect([result.total, result.groupCount]).toEqual([6, 3]);
  });

  it('pages over top-level groups, and sums every matching row', () => {
    const result = queryArray(
      sales,
      { filter: where('amount', '>', 6), group: [{ field: 'country' }], skip: 1, take: 1, count: true, summary: [sum, count], select: ['id'] },
      { locale: 'tr' },
    );
    expect(result.groups).toEqual([{ field: 'country', key: 'TR', count: 3, items: [{ id: 1 }, { id: 2 }, { id: 3 }] }]);
    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect([result.total, result.groupCount, result.summary]).toEqual([4, 2, [67, 4]]);
  });

  it('groups by a value of its own (groupValue), ordered by it, and gives only the groups when asked', () => {
    const month = (row: unknown) => (row as Sale).day.slice(0, 7);
    const ctx = { locale: 'tr', fields: { day: 'date' as const }, groupValue: (f: string) => (f === 'day' ? month : undefined) };
    const result = queryArray(sales, { group: [{ field: 'day', dir: 'desc' }, { field: 'country' }] }, ctx);
    expect(result.groups!.map((g) => [g.key, g.count, g.groups!.map((c) => [c.key, c.items!.map((r) => r.id)])])).toEqual([
      ['2024-03', 1, [['DE', [5]]]],
      ['2024-02', 1, [['TR', [3]]]],
      ['2024-01', 3, [['NO', [6]], ['TR', [1, 2]]]],
      ['2023-12', 1, [['DE', [4]]]],
    ]);
    const only = queryArray(sales, { group: [{ field: 'day' }, { field: 'country' }], groupsOnly: true, groupSummary: [count], count: true }, ctx);
    expect(only.rows).toEqual([]);
    expect(only.groups![3]).toEqual({ field: 'day', key: '2024-03', count: 1, summary: [1], groups: [{ field: 'country', key: 'DE', count: 1, summary: [1] }] });
    expect([only.total, only.groupCount]).toEqual([6, 4]);
    // An order of the groups of its own.
    const order = ['NO', 'TR', 'DE'];
    const ranked = queryArray(sales, { group: [{ field: 'country' }] }, { groupCompare: (f) => (f === 'country' ? (a, b) => order.indexOf(a as string) - order.indexOf(b as string) : undefined) });
    expect(ranked.groups!.map((g) => g.key)).toEqual(['NO', 'TR', 'DE']);
  });

  it('computes each summary type, leaving out empty values', () => {
    const ctx = { locale: 'tr', fields: { day: 'date' as const } };
    expect(
      data.summarize(sales, [count, sum, { type: 'avg', field: 'amount' }, { type: 'min', field: 'day' }, { type: 'max', field: 'city' }, { type: 'min', field: 'amount' }], ctx),
    ).toEqual([6, 72, 14.4, '2023-12-31', 'Oslo', 5]);
    expect(data.summarize([], [count, sum, { type: 'avg', field: 'amount' }, { type: 'max', field: 'amount' }])).toEqual([0, 0, null, null]);
  });

  it('counts empty values as 0 when asked, and reads a field through summaryValue', () => {
    const avg = { type: 'avg', field: 'amount' } as const;
    expect(data.summarize(sales, [{ ...sum, skipEmpty: false }, { ...avg, skipEmpty: false }, avg, { type: 'min', field: 'amount', skipEmpty: false }, { type: 'count', skipEmpty: true }])).toEqual([72, 12, 14.4, 5, 6]);
    const doubled = (row: unknown) => ((row as Sale).amount ?? 0) * 2;
    const ctx = { summaryValue: (f: string) => (f === 'amount' ? doubled : undefined) };
    expect(data.summarize(sales, [sum, { type: 'max', field: 'amount' }, { type: 'max', field: 'id' }], ctx)).toEqual([144, 60, 6]);
  });
});
