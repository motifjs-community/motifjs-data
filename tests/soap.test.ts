import { describe, expect, it } from 'vitest';
import { data } from '../src';
const { SoapAdapter, where } = data;

type Order = { Id: number; Version: number; Customer: string; Amount: number; Shipped: boolean; Note: string | null; Tags: string[]; Lines: { Product: string; Quantity: number }[] };

interface Call {
  url: string;
  headers: Headers;
  body: string;
}

const SHOP = 'http://schemas.datacontract.org/2004/07/Shop';

function envelope(body: string, version: '1.1' | '1.2' = '1.1'): string {
  const ns = version === '1.1' ? 'http://schemas.xmlsoap.org/soap/envelope/' : 'http://www.w3.org/2003/05/soap-envelope';
  return `<s:Envelope xmlns:s="${ns}"><s:Body>${body}</s:Body></s:Envelope>`;
}

// As WCF writes it: base class fields first, `i:nil`, a list of one, text lists in the arrays namespace.
const ORDER_4 =
  '<a:Id>4</a:Id><a:Version>1</a:Version><a:Amount>50.0</a:Amount><a:Customer>Ada Lovelace</a:Customer>' +
  '<a:Lines><a:OrderLine><a:Product>P1</a:Product><a:Quantity>4</a:Quantity></a:OrderLine></a:Lines><a:Note i:nil="true"/>' +
  '<a:Shipped>false</a:Shipped><a:Tags xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays"><b:string>new</b:string></a:Tags>';
const ORDER_5 =
  '<a:Id>5</a:Id><a:Version>2</a:Version><a:Amount>62.5</a:Amount><a:Customer>İsmail Işık</a:Customer><a:Lines/>' +
  '<a:Note>Kapıya</a:Note><a:Shipped>true</a:Shipped><a:Tags xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays"/>';

function result(operation: string, inner: string, self = false): string {
  const attributes = `xmlns:a="${SHOP}" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"`;
  const content = self ? `<${operation}Result ${attributes} i:nil="true"/>` : `<${operation}Result ${attributes}>${inner}</${operation}Result>`;
  return envelope(`<${operation}Response xmlns="http://tempuri.org/">${content}</${operation}Response>`);
}

function xml(text: string, status = 200, type = 'text/xml; charset=utf-8') {
  return new Response(text, { status, headers: { 'content-type': type } });
}

function fakeService(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch = async (input: string, init: RequestInit) => {
    const call = { url: input, headers: new Headers(init.headers), body: String(init.body) };
    calls.push(call);
    return answer(call);
  };
  return { fetch, calls };
}

function make(service: ReturnType<typeof fakeService>, options: Partial<data.SoapAdapterOptions<Order, number>> = {}) {
  return new SoapAdapter<Order, number>({
    url: 'https://host/OrderService.svc',
    key: 'Id',
    locale: 'tr',
    fetch: service.fetch,
    contract: 'IOrderService',
    dataNamespace: SHOP,
    firstFields: ['Id', 'Version'],
    lists: { Tags: 'string', Lines: 'OrderLine', Items: 'Order' },
    fields: { Id: 'number', Version: 'number', Amount: 'number', Shipped: 'boolean', 'Lines.Quantity': 'number' },
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

/** The element children of the operation in a request body, as `name=text`. */
function sentFields(body: string, selector: string): string[] {
  const doc = new DOMParser().parseFromString(body, 'text/xml');
  const element = doc.getElementsByTagName(selector)[0];
  return Array.from(element.children).map((c) => `${c.prefix ? `${c.prefix}:` : ''}${c.localName}=${c.children.length ? `[${c.children.length}]` : (c.getAttribute('i:nil') ?? c.textContent)}`);
}

describe('SoapAdapter', () => {
  it('loads a list and reads it as WCF writes it', async () => {
    const service = fakeService(() => xml(result('GetAllOrders', `<a:Order>${ORDER_4}</a:Order><a:Order>${ORDER_5}</a:Order>`)));
    const { rows } = await make(service).load({ filter: where('Customer', 'contains', 'IŞ'), count: true });

    expect(rows).toEqual([{ Id: 5, Version: 2, Amount: 62.5, Customer: 'İsmail Işık', Lines: [], Note: 'Kapıya', Shipped: true, Tags: [] }]);
    const call = service.calls[0];
    expect(call.url).toBe('https://host/OrderService.svc');
    expect(call.headers.get('content-type')).toBe('text/xml; charset=utf-8');
    expect(call.headers.get('soapaction')).toBe('"http://tempuri.org/IOrderService/GetAllOrders"');
    expect(call.body).toContain('<s:Body><GetAllOrders xmlns="http://tempuri.org/"');
  });

  it('reads a list of one and an empty list as lists', async () => {
    const one = fakeService(() => xml(result('GetAllOrders', `<a:Order>${ORDER_4}</a:Order>`)));
    const [row] = (await make(one).load()).rows;
    expect(row).toMatchObject({ Id: 4, Amount: 50, Shipped: false, Note: null, Tags: ['new'], Lines: [{ Product: 'P1', Quantity: 4 }] });

    const none = fakeService(() => xml(result('GetAllOrders', '')));
    expect((await make(none).load()).rows).toEqual([]);
  });

  it('pages and sorts on the service when the load operation handles it', async () => {
    const service = fakeService(() => xml(result('GetOrders', `<a:Items><a:Order>${ORDER_5}</a:Order></a:Items><a:Total>25</a:Total>`)));
    const adapter = make(service, {
      operations: {
        load: {
          name: 'GetOrders',
          handles: ['paging', 'sort', 'count'],
          args: (o) => ({ skip: o.skip ?? 0, take: o.take ?? 0, sortBy: o.sort?.[0]?.field ?? null, descending: o.sort?.[0]?.dir === 'desc' }),
          read: (r) => {
            const page = r as { Items: Order[]; Total: string };
            return { rows: page.Items, total: Number(page.Total) };
          },
        },
      },
    });
    const page = await adapter.load({ sort: [{ field: 'Amount', dir: 'desc' }], skip: 3, take: 1, count: true });
    expect(page).toMatchObject({ total: 25, rows: [{ Id: 5 }] });
    expect(sentFields(service.calls[0].body, 'GetOrders')).toEqual(['skip=3', 'take=1', 'sortBy=Amount', 'descending=true']);
  });

  it('writes objects as DataContractSerializer reads them', async () => {
    const service = fakeService(() => xml(result('AddOrder', ORDER_4)));
    await make(service).insert({ Customer: '<Ada & Co>', Amount: 5, Version: 0, Note: null, Tags: ['a', 'b'], Lines: [{ Quantity: 2, Product: 'P' }], Id: 0 });

    const body = service.calls[0].body;
    expect(body).toContain(`<AddOrder xmlns="http://tempuri.org/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:d="${SHOP}"`);
    // Base class fields first, then alphabetical.
    expect(sentFields(body, 'order')).toEqual(['d:Id=0', 'd:Version=0', 'd:Amount=5', 'd:Customer=<Ada & Co>', 'd:Lines=[1]', 'd:Note=true', 'd:Tags=[2]']);
    expect(body).toContain('<d:Customer>&lt;Ada &amp; Co&gt;</d:Customer>');
    expect(body).toContain('<d:Lines><d:OrderLine><d:Product>P</d:Product><d:Quantity>2</d:Quantity></d:OrderLine></d:Lines>');
    expect(body).toContain('<d:Tags><arr:string>a</arr:string><arr:string>b</arr:string></d:Tags>');
  });

  it('writes in the given order with the xml serializer', async () => {
    const service = fakeService(() => xml(result('AddOrder', '')));
    await make(service, { serializer: 'xml', firstFields: [], lists: { Tags: 'string' } }).insert({ Customer: 'A', Amount: 1, Tags: ['x'] });
    const body = service.calls[0].body;
    expect(body).not.toContain('xmlns:d=');
    expect(sentFields(body, 'order')).toEqual(['Customer=A', 'Amount=1', 'Tags=[1]']);
    expect(body).toContain('<Tags><string>x</string></Tags>');
  });

  it('takes the key from an operation that returns only the new key', async () => {
    const service = fakeService(() => xml(result('AddOrderReturningId', '101').replace(/<AddOrderReturningIdResult[^>]*>/, '<AddOrderReturningIdResult>')));
    const adapter = make(service, { operations: { load: { name: 'GetAllOrders' }, insert: { name: 'AddOrderReturningId', args: (order) => ({ order }) } } });
    expect(await adapter.insert({ Customer: 'A', Amount: 1 })).toEqual({ Customer: 'A', Amount: 1, Id: 101 });
  });

  it('finds by key; a nil result is no row', async () => {
    const service = fakeService((call) => xml(call.body.includes('<id>4</id>') ? result('GetOrder', ORDER_4) : result('GetOrder', '', true)));
    expect(await make(service).byKey(4)).toMatchObject({ Id: 4, Customer: 'Ada Lovelace' });
    expect(await make(service).byKey(999)).toBeUndefined();
  });

  it('turns SOAP 1.1 and 1.2 faults into errors, or into what readFault returns', async () => {
    const fault11 = envelope(
      '<s:Fault><faultcode>s:Client</faultcode><faultstring xml:lang="en-US">No order 999.</faultstring>' +
        `<detail><OrderFault xmlns="${SHOP}" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><Field i:nil="true"/><Kind>NotFound</Kind></OrderFault></detail></s:Fault>`,
    );
    const fault12 = envelope(
      '<s:Fault><s:Code><s:Value>s:Receiver</s:Value><s:Subcode><s:Value xmlns:a="x">a:InternalServiceFault</s:Value></s:Subcode></s:Code>' +
        '<s:Reason><s:Text xml:lang="en-US">Internal error</s:Text></s:Reason></s:Fault>',
      '1.2',
    );
    const service = fakeService((call) => (call.body.includes('DeleteOrder') ? xml(fault11, 500) : xml(fault12, 500, 'application/soap+xml; charset=utf-8')));

    await expect(make(service).remove(999)).rejects.toMatchObject({
      code: 'MJD202',
      status: 500,
      plainMessage: 'No order 999.',
      details: { code: 'Client', message: 'No order 999.', detail: { OrderFault: { Field: null, Kind: 'NotFound' } } },
    });
    await expect(make(service, { version: '1.2' }).load()).rejects.toMatchObject({ code: 'MJD201', details: { code: 'Receiver', subcode: 'InternalServiceFault' } });

    const mapped = make(service, {
      readFault: (fault, operation) => {
        const kind = (fault.detail as { OrderFault?: { Kind: string } } | undefined)?.OrderFault?.Kind;
        if (kind === 'NotFound') return data.DataError.create('MJD204', { operation, message: fault.message });
      },
    });
    await expect(mapped.remove(999)).rejects.toMatchObject({ code: 'MJD204', kind: 'not-found', operation: 'remove' });
  });

  it('reads a fault sent with status 200 and rejects what is not an envelope', async () => {
    const service = fakeService((call) =>
      call.body.includes('GetOrder') ? xml(envelope('<s:Fault><faultcode>s:Server</faultcode><faultstring>Down</faultstring></s:Fault>')) : xml('<html>Bad gateway</html>'),
    );
    await expect(make(service).byKey(1)).rejects.toMatchObject({ code: 'MJD201', plainMessage: 'Down' });
    await expect(make(service).load()).rejects.toMatchObject({ code: 'MJD104', plainMessage: 'The answer could not be read: no SOAP envelope.' });
  });

  it('sends SOAP 1.2 with WS-Addressing and extra headers', async () => {
    const service = fakeService(() => xml(result('GetAllOrders', '').replace('http://schemas.xmlsoap.org/soap/envelope/', 'http://www.w3.org/2003/05/soap-envelope'), 200, 'application/soap+xml'));
    await make(service, { version: '1.2', addressing: true, soapHeader: () => '<Token xmlns="urn:auth">abc</Token>' }).load();
    const { headers, body } = service.calls[0];
    expect(headers.get('content-type')).toBe('application/soap+xml; charset=utf-8; action="http://tempuri.org/IOrderService/GetAllOrders"');
    expect(headers.has('soapaction')).toBe(false);
    expect(body).toContain('<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">');
    expect(body).toContain('<a:Action s:mustUnderstand="1">http://tempuri.org/IOrderService/GetAllOrders</a:Action>');
    expect(body).toMatch(/<a:MessageID>urn:uuid:[0-9a-f-]{36}<\/a:MessageID>/);
    expect(body).toContain('<a:To s:mustUnderstand="1">https://host/OrderService.svc</a:To>');
    expect(body).toContain('<Token xmlns="urn:auth">abc</Token></s:Header>');
  });

  it('rejects a list without an item name, and saves through a save operation', async () => {
    const service = fakeService((call) =>
      xml(result('SaveOrders', call.body.includes('<d:Id>3</d:Id>') ? '<a:boolean>false</a:boolean>' : '<a:boolean>true</a:boolean><a:boolean>false</a:boolean>')),
    );
    await expect(make(service, { lists: {} }).insert({ Customer: 'A', Tags: ['x'] })).rejects.toMatchObject({ code: 'MJD302', operation: 'insert' });

    const adapter = make(service, {
      operations: {
        load: { name: 'GetAllOrders' },
        save: {
          name: 'SaveOrders',
          args: (changes) => ({ orders: changes.map((c) => (c.type === 'remove' ? { Id: c.key } : c.data)) }),
          read: (r) => (r as string[]).map((ok) => (ok === 'true' ? { ok: true } : { ok: false, error: new Error('Not saved') })),
        },
      },
      // The result is a list too, so that one answer still reads as a list.
      lists: { orders: 'Order', SaveOrdersResult: 'boolean' },
    });
    const outcomes = await adapter.save([
      { type: 'update', key: 1, data: { Amount: 2 } },
      { type: 'remove', key: 2 },
    ]);
    expect(outcomes.map((o) => o.ok)).toEqual([true, false]);
    expect(service.calls.at(-1)!.body).toContain('<orders><d:Order><d:Amount>2</d:Amount></d:Order><d:Order><d:Id>2</d:Id></d:Order></orders>');
    await expect(adapter.remove(3)).rejects.toMatchObject({ plainMessage: 'Not saved' });
  });
});
