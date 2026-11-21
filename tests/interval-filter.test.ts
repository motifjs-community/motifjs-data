import { describe, expect, it } from 'vitest';
import { data } from '../src';
const { ArrayAdapter, DataSource, ODataAdapter, and, createRowFilter, toODataFilter, where } = data;

type Sale = { id: number; region: string; day: string | null; amount: number | null };

const sales: Sale[] = [
  { id: 1, region: 'North', day: '2023-11-02', amount: 100 },
  { id: 2, region: 'North', day: '2024-01-15', amount: 50 },
  { id: 3, region: 'South', day: '2024-05-01', amount: 30 },
  { id: 4, region: 'South', day: '2024-07-04', amount: null },
  { id: 5, region: 'East', day: null, amount: 20 },
  { id: 6, region: 'East', day: 'not a date', amount: 75.5 },
];
const ctx: data.EvaluateContext = { locale: 'en-US', fields: { day: 'date' } };
const ids = (filter: data.FilterExpression) => sales.filter(createRowFilter(filter, ctx)).map((s) => s.id);

describe('conditions through an interval', () => {
  it('compare the value an interval reads, as a pivot level groups it', () => {
    expect(ids(where('day', '=', 2024, { interval: 'year' }))).toEqual([2, 3, 4]);
    expect(ids(where('day', '=', 2, { interval: 'quarter' }))).toEqual([3]);
    expect(ids(where('day', 'in', [1, 7], { interval: 'month' }))).toEqual([2, 4]);
    expect(ids(where('day', '=', new Date(2024, 4, 1), { interval: 'date' }))).toEqual([3]);
    expect(ids(where('day', '>=', 2024, { interval: 'year' }))).toEqual([2, 3, 4]);
    // Ranges of 50: 50 to 100, 75.5 among them; 100 starts the next.
    expect(ids(where('amount', '=', 50, { interval: 50 }))).toEqual([2, 6]);
    // A value the interval cannot read is blank.
    expect(ids(where('day', 'isblank', undefined, { interval: 'year' }))).toEqual([5, 6]);
    expect(ids(and(where('region', '=', 'south'), where('day', '=', 3, { interval: 'month' }))!)).toEqual([]);
  });

  it('are written with the date functions of OData, or not at all for the day of the week', () => {
    const odata = (filter: data.FilterExpression) => toODataFilter(filter, { fields: { OrderDate: 'date', Freight: 'number' } });
    expect(odata(where('OrderDate', '=', 2024, { interval: 'year' }))).toBe('year(OrderDate) eq 2024');
    expect(odata(where('OrderDate', '=', 2, { interval: 'quarter' }))).toBe('(month(OrderDate) add 2) div 3 eq 2');
    expect(odata(where('OrderDate', '=', new Date(2024, 2, 5), { interval: 'date' }))).toBe('date(OrderDate) eq 2024-03-05');
    expect(odata(where('Freight', '=', 100, { interval: 50 }))).toBe('floor(Freight div 50.0) mul 50 eq 100');
    expect(odata(where('OrderDate', 'isblank', undefined, { interval: 'month' }))).toBe('OrderDate eq null');
    expect(() => odata(where('OrderDate', '=', 1, { interval: 'dayOfWeek' }))).toThrow(TypeError);
    const adapter = new ODataAdapter<{ OrderDate: string }, number>({ url: 'https://host/odata/Orders', key: 'OrderID' as never, fields: { OrderDate: 'date' } });
    expect([adapter.canFilter(where('OrderDate', '=', 2024, { interval: 'year' })), adapter.canFilter(where('OrderDate', '=', 1, { interval: 'dayOfWeek' })), adapter.canFilter(null)]).toEqual([true, false, true]);
    expect(new ArrayAdapter<Sale, number>({ data: sales, key: 'id' }).canFilter(where('day', '=', 1, { interval: 'dayOfWeek' }))).toBe(true);
  });

  it('are checked', () => {
    expect(() => createRowFilter(where('day', '=', 2024, { interval: 'decade' as data.PivotInterval }), ctx)).toThrow(/unknown interval/);
  });
});

describe('DataSource.narrow', () => {
  it('makes a data source of the rows of the query that a filter keeps too', async () => {
    const source = new DataSource<Sale, number>({ adapter: new ArrayAdapter<Sale, number>({ data: sales, key: 'id', fields: { day: 'date' } }), filter: where('region', '<>', 'East'), searchFields: ['region'] });
    await source.search('nor');
    const narrowed = source.narrow(where('day', '=', 2024, { interval: 'year' }), { loadMode: 'all' });
    await narrowed.load();
    expect(narrowed.rows.map((s) => s.id)).toEqual([2]);
    expect(narrowed.adapter).toBe(source.adapter);
    narrowed.dispose();
    source.dispose();
  });
});
