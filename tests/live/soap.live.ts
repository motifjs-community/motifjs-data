// @vitest-environment jsdom
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { data } from '../../src';
const { ChangeTracker, DataSource, SoapAdapter, queryArray, sortRows, where } = data;

// A CoreWCF service built from ./wcf-service (needs the .NET SDK), and a public SOAP service.

type Order = {
  Id: number;
  Version: number;
  Customer: string;
  Amount: number;
  OrderDate: string;
  Shipped: boolean;
  Note: string | null;
  Tags: string[];
  Lines: { Product: string; Quantity: number }[];
};

const WCF = 'http://localhost:5191';
const project = resolve('tests/live/wcf-service');
const hasDotnet = (() => {
  try {
    execFileSync('dotnet', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function orders(path = '/OrderService.svc', options: Partial<data.SoapAdapterOptions<Order, number>> = {}) {
  return new SoapAdapter<Order, number>({
    url: WCF + path,
    key: 'Id',
    locale: 'tr',
    contract: 'IOrderService',
    dataNamespace: 'http://schemas.datacontract.org/2004/07/Shop',
    firstFields: ['Id', 'Version'],
    lists: { Tags: 'string', Lines: 'OrderLine', Items: 'Order' },
    fields: { Id: 'number', Version: 'number', Amount: 'number', Shipped: 'boolean', OrderDate: 'datetime', 'Lines.Quantity': 'number' },
    readFault: (fault, operation) => {
      const detail = (fault.detail as { OrderFault?: { Kind: string; Field: string | null } } | undefined)?.OrderFault;
      if (detail?.Kind === 'Conflict') return data.DataError.create('MJD205', { operation }, fault.message);
      if (detail?.Kind === 'NotFound') return data.DataError.create('MJD204', { operation, message: fault.message });
      if (detail?.Kind === 'Invalid' && detail.Field) return data.DataError.create('MJD202', { operation, fields: { [detail.Field]: fault.message } }, fault.message);
    },
    operations: {
      load: { name: 'GetAllOrders' },
      byKey: { name: 'GetOrder', args: (id) => ({ id }) },
      insert: { name: 'AddOrder', args: (order) => ({ order }) },
      update: { name: 'UpdateOrder', args: (id, changes, original) => ({ order: { ...original, ...changes, Id: id } }) },
      remove: { name: 'DeleteOrder', args: (id) => ({ id }) },
    },
    ...options,
  });
}

describe.skipIf(!hasDotnet)('SoapAdapter on a WCF service', () => {
  let server: ChildProcess;
  let all: Order[];

  beforeAll(async () => {
    execFileSync('dotnet', ['build', project, '-c', 'Release', '--nologo', '-v', 'q'], { stdio: 'ignore' });
    server = spawn('dotnet', [`${project}/bin/Release/net9.0/WcfOrderService.dll`], { env: { ...process.env, WCF_URL: WCF }, stdio: 'ignore' });
    for (let tries = 0; ; tries++) {
      const ready = await fetch(`${WCF}/OrderService.svc?wsdl`).then((r) => r.ok, () => false);
      if (ready) break;
      if (tries > 60) throw new Error('the WCF service did not start');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    all = (await orders().load()).rows;
  });

  afterAll(() => {
    server?.kill();
  });

  it('reads lists of none, one and two, nil and typed fields', () => {
    expect(all).toHaveLength(25);
    expect(all.find((o) => o.Id === 4)).toEqual({
      Id: 4,
      Version: 1,
      Amount: 50,
      Customer: 'Ada Lovelace',
      Lines: [{ Product: 'P1', Quantity: 4 }],
      Note: null,
      OrderDate: '2024-01-13T00:00:00Z',
      Shipped: false,
      Tags: ['new'],
    });
    expect(all.find((o) => o.Id === 3)).toMatchObject({ Tags: [], Lines: [], Shipped: true });
    expect(all.find((o) => o.Id === 5)!.Tags).toEqual(['new', 'gift']);
  });

  it('filters, sorts and pages in memory what the operation does not', async () => {
    const options = { filter: where('Customer', 'contains', 'IŞ'), sort: [{ field: 'Amount', dir: 'desc' as const }], skip: 1, take: 2, count: true };
    const page = await orders().load(options);
    const expected = queryArray(all, options, { locale: 'tr' });
    expect(page).toEqual(expected);
    expect(page.rows.every((o) => o.Customer === 'İsmail Işık')).toBe(true);
  });

  it('pages and sorts on the service when the operation handles it', async () => {
    const paged = orders('/OrderService.svc', {
      operations: {
        load: {
          name: 'GetOrders',
          handles: ['paging', 'sort', 'count'],
          args: (o) => ({ skip: o.skip ?? 0, take: o.take ?? 0, sortBy: o.sort?.[0]?.field ?? null, descending: o.sort?.[0]?.dir === 'desc' }),
          read: (result) => {
            const page = result as { Items: Order[]; Total: string };
            return { rows: page.Items, total: Number(page.Total) };
          },
        },
      },
    });
    const page = await paged.load({ sort: [{ field: 'Amount', dir: 'desc' }], skip: 3, take: 1, count: true });
    expect(page.total).toBe(25);
    expect(page.rows.map((o) => o.Id)).toEqual(sortRows(all, [{ field: 'Amount', dir: 'desc' }]).slice(3, 4).map((o) => o.Id));
  });

  it('finds by key; a missing row is undefined', async () => {
    expect(await orders().byKey(4)).toEqual(all.find((o) => o.Id === 4));
    expect(await orders().byKey(999)).toBeUndefined();
  });

  it('inserts, updates with the version and removes; every field reaches the service', async () => {
    const adapter = orders();
    const sent = { Customer: 'Şule <Aydın> & Co', Amount: 12.75, OrderDate: '2024-05-06T07:08:09Z', Shipped: true, Note: null, Tags: ['a', 'b'], Lines: [{ Product: 'X', Quantity: 3 }] };
    const saved = await adapter.insert(sent);
    expect(saved).toEqual({ ...sent, Id: 100, Version: 1 });

    // Version is a base class field: written first, or WCF reads it as 0.
    const updated = await adapter.update(100, { Amount: 20 }, { original: saved });
    expect(updated).toMatchObject({ Id: 100, Version: 2, Amount: 20, Customer: 'Şule <Aydın> & Co', Tags: ['a', 'b'] });
    await expect(adapter.update(100, { Amount: 30 }, { original: saved })).rejects.toMatchObject({ code: 'MJD205', plainMessage: 'The order was changed by someone else.' });
    // Without firstFields, Id and Version come after Amount, and WCF skips them: it looks for order 0.
    await expect(orders('/OrderService.svc', { firstFields: [] }).update(100, { Amount: 30 }, { original: { ...saved, ...updated } as Order })).rejects.toMatchObject({
      code: 'MJD204',
      plainMessage: 'No order 0.',
    });

    await expect(adapter.update(100, { Amount: -1 }, { original: { ...saved, ...updated } as Order })).rejects.toMatchObject({
      code: 'MJD202',
      fields: { Amount: 'Amount must not be negative.' },
    });

    await adapter.remove(100);
    expect(await adapter.byKey(100)).toBeUndefined();
    await expect(adapter.remove(100)).rejects.toMatchObject({ code: 'MJD204', plainMessage: 'No order 100.' });
  });

  it('ChangeTracker: edits in a row carry the newest Version', async () => {
    const source = new DataSource<Order, number>({ adapter: orders(), loadMode: 'all' });
    await source.load();
    const tracker = new ChangeTracker<Order, number>({ source });
    const order = source.rowByKey(7)!;
    for (const amount of [70, 71]) {
      tracker.setValue(order, 'Amount', amount);
      expect(await tracker.commit(order)).toBe(true);
    }
    expect(order).toMatchObject({ Amount: 71, Version: 3 });
    expect((await orders().byKey(7))?.Amount).toBe(71);

    tracker.setValue(order, 'Amount', -5);
    expect(await tracker.commit(order)).toBe(false);
    expect(tracker.errorsOf(order)).toMatchObject({ Amount: 'Amount must not be negative.' });
  });

  it('maps a fault without readFault by its code', async () => {
    await expect(orders('/OrderService.svc', { readFault: undefined }).remove(999)).rejects.toMatchObject({ code: 'MJD202', status: 500, plainMessage: 'No order 999.' });
  });

  it('takes the new key from an operation that returns only the key', async () => {
    const adapter = orders('/OrderService.svc', { operations: { load: { name: 'GetAllOrders' }, insert: { name: 'AddOrderReturningId', args: (order) => ({ order }) } } });
    const saved = await adapter.insert({ Customer: 'Ada', Amount: 1, OrderDate: '2024-01-01T00:00:00Z' });
    expect(saved).toMatchObject({ Customer: 'Ada', Id: expect.any(Number) });
    expect((await orders().byKey(saved.Id))?.Customer).toBe('Ada');
  });

  it('talks SOAP 1.2 with WS-Addressing', async () => {
    const soap12 = orders('/OrderService12.svc', { version: '1.2', addressing: true });
    expect((await soap12.load()).rows.length).toBeGreaterThanOrEqual(25);
    expect((await soap12.byKey(4))?.Customer).toBe('Ada Lovelace');
    await expect(soap12.remove(999)).rejects.toMatchObject({ code: 'MJD204' });
  });
});

describe('SoapAdapter on CountryInfo (public, XmlSerializer style)', () => {
  type Country = { sISOCode: string; sName: string; sCapitalCity?: string; Languages?: { sISOCode: string; sName: string }[] };

  const countries = (version: '1.1' | '1.2' = '1.1') =>
    new SoapAdapter<Country, string>({
      url: 'http://webservices.oorsprong.org/websamples.countryinfo/CountryInfoService.wso',
      key: 'sISOCode',
      locale: 'en-US',
      version,
      serializer: 'xml',
      namespace: 'http://www.oorsprong.org/websamples.countryinfo',
      lists: { Languages: 'tLanguage' },
      retry: { retries: 2 },
      operations: {
        load: { name: 'ListOfCountryNamesByName' },
        byKey: { name: 'FullCountryInfo', args: (code) => ({ sCountryISOCode: code }) },
      },
    });

  it('loads every country and filters in memory', async () => {
    const all = (await countries().load()).rows;
    expect(all.length).toBeGreaterThan(200);
    const found = await countries().load({ filter: where('sName', 'startswith', 'TUR'), sort: [{ field: 'sName', dir: 'asc' }] });
    expect(found.rows).toEqual(sortRows(queryArray(all, { filter: where('sName', 'startswith', 'TUR') }, { locale: 'en-US' }).rows, [{ field: 'sName', dir: 'asc' }]));
    expect(found.rows.map((c) => c.sISOCode)).toContain('TR');
  });

  it('finds a country with a list of one language, over SOAP 1.1 and 1.2', async () => {
    for (const version of ['1.1', '1.2'] as const) {
      const turkey = await countries(version).byKey('TR');
      expect(turkey).toMatchObject({ sISOCode: 'TR', sName: 'Turkey', sCapitalCity: 'Ankara', Languages: [{ sName: 'Turkish' }] });
    }
  });
});
