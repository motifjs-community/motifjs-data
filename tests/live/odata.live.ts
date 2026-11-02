import { beforeAll, describe, expect, it, vi } from 'vitest';
import { data } from '../../src';
const { and, ChangeTracker, DataSource, not, ODataAdapter, or, queryArray, sortRows, where } = data;

// Northwind is read only; TripPinServiceRW keeps writes in a private session per run.
const NORTHWIND = 'https://services.odata.org/V4/Northwind/Northwind.svc/';
const TRIPPIN = `https://services.odata.org/V4/(S(motifjsdata${Date.now()}))/TripPinServiceRW/`;

type Row = Record<string, unknown>;

function northwind(set: string, key: string | string[], fields = {}) {
  return new ODataAdapter<Row, unknown>({ url: NORTHWIND + set, key, fields, locale: 'en-US', retry: { retries: 2 } });
}

/** The service filters `rows` again with `$filter`; it must keep the rows memory keeps. */
async function expectSameAsMemory(adapter: data.ODataAdapter<Row, unknown>, rows: Row[], filter: data.FilterExpression, key: string) {
  const server = (await adapter.load({ filter })).rows.map((r) => r[key]).sort();
  const memory = queryArray(rows, { filter }, { fields: adapter.fields, locale: adapter.locale })
    .rows.map((r) => r[key])
    .sort();
  expect(server).toEqual(memory);
  return server.length;
}

describe('ODataAdapter on Northwind', () => {
  const customers = northwind('Customers', 'CustomerID', { Region: 'string', Fax: 'string', Country: 'string', CompanyName: 'string', City: 'string' });
  const orders = northwind('Orders', 'OrderID', { OrderDate: 'datetime', ShippedDate: 'datetime', ShipRegion: 'string' });
  const products = northwind('Products', 'ProductID');
  let allCustomers: Row[];
  let allOrders: Row[];

  beforeAll(async () => {
    const result = await customers.load({ count: true });
    expect(result.total).toBe(91);
    allCustomers = result.rows;
    allOrders = (await orders.load()).rows;
  });

  it('follows @odata.nextLink through every page', () => {
    // The service answers 20 rows a page.
    expect(allCustomers).toHaveLength(91);
    expect(allOrders).toHaveLength(830);
  });

  it.each<[string, data.FilterExpression]>([
    ['contains without case', where('CompanyName', 'contains', 'MARKET')],
    ['notcontains keeps empty values', where('Region', 'notcontains', 'a')],
    ['startswith', where('City', 'startswith', 'b')],
    ['endswith', where('City', 'endswith', 'ON')],
    ['isblank', where('Region', 'isblank')],
    ['isnotblank', where('Region', 'isnotblank')],
    ['= null', where('Fax', '=', null)],
    ['<> keeps empty values', where('Region', '<>', 'wa')],
    ['in', where('Country', 'in', ['germany', 'UK'])],
    ['notin with null', where('Region', 'notin', ['WA', null])],
    ['not', not(where('Country', '=', 'usa'))],
    ['or of ands', or(and(where('Country', '=', 'Germany'), where('City', 'startswith', 'b')), where('Country', '=', 'Mexico'))!],
    ['between text', where('Country', 'between', ['f', 'h'])],
    ['an empty text value filters nothing', and(where('City', 'contains', ''), where('Country', '=', 'France'))!],
  ])('customers: %s', async (_, filter) => {
    await expectSameAsMemory(customers, allCustomers, filter, 'CustomerID');
  });

  it.each<[string, data.FilterExpression]>([
    ['between decimals', where('Freight', 'between', [10, 20])],
    ['datetime >=', where('OrderDate', '>=', new Date('1998-04-01T00:00:00Z'))],
    ['datetime isblank', where('ShippedDate', 'isblank')],
    ['in numbers', where('EmployeeID', 'in', [1, 2])],
    ['= empty text is null or empty', where('ShipRegion', '=', '')],
  ])('orders: %s', async (_, filter) => {
    expect(await expectSameAsMemory(orders, allOrders, filter, 'OrderID')).toBeGreaterThan(0);
  });

  it('products: booleans and decimals', async () => {
    const all = (await products.load()).rows;
    await expectSameAsMemory(products, all, where('Discontinued', '=', true), 'ProductID');
    await expectSameAsMemory(products, all, where('UnitPrice', '>', 50), 'ProductID');
  });

  it('pages, sorts, counts and selects on the service', async () => {
    const filter = where('ShipCountry', '=', 'germany');
    const page = await orders.load({ filter, sort: [{ field: 'Freight', dir: 'desc' }], skip: 5, take: 3, count: true, select: ['OrderID', 'Freight'] });
    const expected = sortRows(queryArray(allOrders, { filter }, { locale: 'en-US' }).rows, [{ field: 'Freight', dir: 'desc' }]);
    expect(page.total).toBe(expected.length);
    expect(page.rows.map((r) => r.OrderID)).toEqual(expected.slice(5, 8).map((r) => r.OrderID));
    expect(Object.keys(page.rows[0]).filter((k) => !k.startsWith('@'))).toEqual(['OrderID', 'Freight']);
  });

  it('expands nested navigation properties', async () => {
    const [order] = (await orders.load({ filter: where('OrderID', '=', 10248), expand: ['Customer', 'Order_Details.Product'] })).rows as {
      Customer: Row;
      Order_Details: { Product: Row }[];
    }[];
    expect(order.Customer.CustomerID).toBe('VINET');
    expect(order.Order_Details.map((d) => d.Product.ProductName)).toEqual(['Queso Cabrales', 'Singaporean Hokkien Fried Mee', 'Mozzarella di Giovanni']);
  });

  it('DataSource: searches a page of customers and finds a value off the page, like a combo box', async () => {
    const source = new DataSource<Row, unknown>({
      adapter: customers,
      pageSize: 5,
      searchFields: ['CompanyName', 'ContactName'],
      sort: [{ field: 'CustomerID', dir: 'asc' }],
      select: ['CustomerID', 'CompanyName', 'ContactName'],
    });
    await source.search('MAR');
    const filter = or(where('CompanyName', 'contains', 'MAR'), where('ContactName', 'contains', 'MAR'));
    const expected = queryArray(allCustomers, { filter, sort: [{ field: 'CustomerID', dir: 'asc' }] }, { locale: 'en-US' }).rows;
    expect(source.status).toBe('ready');
    expect(source.total).toBe(expected.length);
    expect(source.rows.map((r) => r.CustomerID)).toEqual(expected.slice(0, 5).map((r) => r.CustomerID));
    await source.setPage(1);
    expect(source.rows.map((r) => r.CustomerID)).toEqual(expected.slice(5, 10).map((r) => r.CustomerID));
    expect((await source.byKey('WOLZA'))?.CompanyName).toBe('Wolski  Zajazd');
  });

  it('DataSource: loads blocks where a virtual list looks', async () => {
    const source = new DataSource<Row, unknown>({ adapter: orders, loadMode: 'blocks', pageSize: 100, sort: [{ field: 'OrderID', dir: 'asc' }] });
    await source.load();
    expect([source.total, source.rowAt(0)?.OrderID, source.rowAt(100)]).toEqual([830, 10248, undefined]);
    source.ensure(780, 830, true);
    await vi.waitFor(() => expect(source.rowAt(829)?.OrderID).toBe(11077), { timeout: 15_000 });
    expect(source.rowAt(500)).toBeUndefined();
  });

  it('DataSource: groups orders by country with sums, in memory (Northwind has no $apply)', async () => {
    const filter = where('EmployeeID', '=', 1);
    const summary: data.SummaryItem[] = [{ type: 'count' }, { type: 'sum', field: 'Freight' }];
    const groupSummary: data.SummaryItem[] = [{ type: 'sum', field: 'Freight' }, { type: 'max', field: 'OrderDate' }];
    const source = new DataSource<Row, unknown>({ adapter: orders, loadMode: 'all', filter, group: [{ field: 'ShipCountry' }], groupSummary, summary });
    await source.load();
    const expected = queryArray(allOrders, { filter, group: [{ field: 'ShipCountry' }], groupSummary, summary }, { fields: orders.fields, locale: 'en-US' });
    expect(source.groups.map((g) => [g.key, g.count, g.summary])).toEqual(expected.groups!.map((g) => [g.key, g.count, g.summary]));
    expect(source.summary).toEqual(expected.summary);
    expect(source.groups.reduce((n, g) => n + g.count, 0)).toBe(source.summary[0]);
  });

  it('counts and finds by key', async () => {
    expect(await orders.count({ filter: where('EmployeeID', '=', 1) })).toBe(allOrders.filter((r) => r.EmployeeID === 1).length);
    expect((await customers.byKey('ALFKI'))?.CompanyName).toBe('Alfreds Futterkiste');
    expect((await northwind('Order_Details', ['OrderID', 'ProductID']).byKey({ OrderID: 10248, ProductID: 11 }))?.Quantity).toBe(12);
    expect(await customers.byKey('NONE!')).toBeUndefined();
  });
});

describe('ODataAdapter on TripPin RESTier ($apply)', () => {
  const people = new ODataAdapter<Row, string>({
    url: `https://services.odata.org/TripPinRESTierService/(S(motifjsagg${Date.now()}))/People`,
    key: 'UserName',
    locale: 'en-US',
    aggregation: true,
    retry: { retries: 2 },
  });

  it('computes summaries on the service the way memory does', async () => {
    const all = (await people.load()).rows;
    const filter = where('LastName', 'contains', 'E');
    const summary: data.SummaryItem[] = [{ type: 'count' }, { type: 'sum', field: 'Age' }, { type: 'min', field: 'Age' }, { type: 'max', field: 'Age' }, { type: 'avg', field: 'Age' }];
    const requests: string[] = [];
    const sub = people.onRequesting((r) => requests.push(r.query.get('$apply') ?? ''));
    const server = await people.load({ filter, summary, take: 0 });
    sub.dispose();
    const memory = queryArray(all, { filter, summary }, { locale: 'en-US' }).summary!;
    expect(requests).toEqual(["filter(contains(tolower(LastName),'e'))/aggregate($count as s0,Age with sum as s1,Age with min as s2,Age with max as s3,Age with average as s4)"]);
    expect(server.summary!.slice(0, 4)).toEqual(memory.slice(0, 4));
    expect(Number(server.summary![4])).toBeCloseTo(Number(memory[4]), 6);
    expect(memory[0]).toBeGreaterThan(0);
  });
});

describe('ODataAdapter on TripPin (writes)', () => {
  const people = new ODataAdapter<Row, string>({ url: TRIPPIN + 'People', key: 'UserName' });
  const user = `motif${Date.now() % 100000}`;
  const person = (userName: string, firstName: string) => ({ UserName: userName, FirstName: firstName, LastName: 'Test', Emails: [], AddressInfo: [], Gender: 'Female' });

  it('inserts, updates with the etag and reports a stale etag', async () => {
    const saved = await people.insert(person(user, 'Ada'));
    expect(saved['@odata.etag']).toMatch(/^W\//);

    const changed = await people.update(user, { FirstName: 'Augusta' }, { original: saved });
    expect(changed).toMatchObject({ FirstName: 'Augusta' });
    expect(changed['@odata.etag']).not.toBe(saved['@odata.etag']);

    await expect(people.update(user, { FirstName: 'Stale' }, { original: saved })).rejects.toMatchObject({ code: 'MJD205', status: 412 });
    await expect(people.remove(user)).rejects.toMatchObject({ code: 'MJD305', status: 428 });
    expect((await people.byKey(user))?.FirstName).toBe('Augusta');
  });

  it('saves a $batch with one outcome per change', async () => {
    const batch = new ODataAdapter<Row, string>({ url: TRIPPIN + 'People', key: 'UserName', batch: true });
    const current = await people.byKey(user);
    const outcomes = await batch.save([
      { type: 'update', key: user, data: { LastName: 'King' }, original: current },
      { type: 'update', key: 'russellwhyte', data: { FirstName: 'R' }, original: { '@odata.etag': 'W/"0"' } },
      { type: 'insert', data: person(`${user}b`, 'Bee') },
    ]);
    expect(outcomes.map((o) => (o.ok ? 'ok' : (o.error as data.DataError).code))).toEqual(['ok', 'MJD205', 'ok']);
    expect((await people.byKey(user))?.LastName).toBe('King');
  });

  // This sample service answers a change set part by part and does not roll it back,
  // so the test checks that each outcome tells what the service kept.
  it('sends a change set and reports what the service kept', async () => {
    const bodies: unknown[] = [];
    const atomic = new ODataAdapter<Row, string>({
      url: TRIPPIN + 'People',
      key: 'UserName',
      batch: { allOrNothing: true },
      beforeSend: (request) => void bodies.push(request.body),
    });
    const bee = await people.byKey(`${user}b`);
    const outcomes = await atomic.save([
      { type: 'update', key: `${user}b`, data: { FirstName: 'Changed' }, original: bee },
      { type: 'update', key: 'russellwhyte', data: { FirstName: 'R' }, original: { '@odata.etag': 'W/"0"' } },
    ]);
    expect(String(bodies[0])).toMatch(/Content-Type: multipart\/mixed; boundary=changeset_/);
    expect((outcomes[1].ok ? 'ok' : (outcomes[1].error as data.DataError).code)).toBe('MJD205');
    expect((await people.byKey(`${user}b`))?.FirstName).toBe(outcomes[0].ok ? 'Changed' : 'Bee');
  });

  it('ChangeTracker: edits in a row carry the newest etag, alone or in one $batch', async () => {
    const source = new DataSource<Row, string>({ adapter: people, loadMode: 'all', filter: where('UserName', 'in', [user, `${user}b`]) });
    await source.load();
    const tracker = new ChangeTracker<Row, string>({ source });
    const row = source.rowByKey(user)!;
    for (const name of ['First', 'Second']) {
      tracker.setValue(row, 'FirstName', name);
      expect(await tracker.commit(row)).toBe(true);
    }
    expect((await people.byKey(user))?.FirstName).toBe('Second');

    const batchSource = new DataSource<Row, string>({ adapter: new ODataAdapter<Row, string>({ url: TRIPPIN + 'People', key: 'UserName', batch: true }), loadMode: 'all', filter: source.filter });
    await batchSource.load();
    const batch = new ChangeTracker<Row, string>({ source: batchSource, saveMode: 'batch' });
    for (const r of batchSource.rows) batch.setValue(r, 'LastName', 'Batched');
    expect(await batch.saveChanges()).toEqual({ saved: 2, failed: 0 });
    expect([(await people.byKey(user))?.LastName, (await people.byKey(`${user}b`))?.LastName]).toEqual(['Batched', 'Batched']);
  });

  it('removes with the etag', async () => {
    for (const name of [user, `${user}b`]) {
      await people.remove(name, { original: await people.byKey(name) });
      expect(await people.byKey(name)).toBeUndefined();
    }
  });
});
