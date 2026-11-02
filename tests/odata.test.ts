import { describe, expect, it } from 'vitest';
import { data } from '../src';
const { and, none, not, ODataAdapter, or, toODataFilter, where } = data;

type Order = { id: number; customer: string; amount: number; shipped?: Date | string; '@odata.etag'?: string };

interface Call {
  method: string;
  url: string;
  path: string;
  query: Record<string, string>;
  headers: Headers;
  body: string | undefined;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; odata.metadata=minimal', ...headers } });

/** A service at https://host/odata that answers with `answer`, reached through the adapter's `fetch` option. */
function fakeService(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const call: Call = {
      method: init.method!,
      url: input,
      path: decodeURIComponent(url.pathname),
      query: Object.fromEntries(url.searchParams),
      headers: new Headers(init.headers),
      body: init.body == null ? undefined : String(init.body),
    };
    calls.push(call);
    return answer(call);
  };
  return { fetch, calls };
}

function make(service: ReturnType<typeof fakeService>, options: Partial<data.ODataAdapterOptions<Order, number>> = {}) {
  return new ODataAdapter<Order, number>({ url: 'https://host/odata/Orders', key: 'id', locale: 'en-US', fetch: service.fetch, ...options });
}

function batchAnswer(boundary: string, parts: string[]): Response {
  const body = parts.map((p) => `--${boundary}\r\n${p}\r\n`).join('') + `--${boundary}--\r\n`;
  return new Response(body, { status: 200, headers: { 'content-type': `multipart/mixed; boundary=${boundary}` } });
}

function httpPart(status: string, headers: Record<string, string> = {}, body?: unknown, contentId?: string): string {
  const head = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join('');
  const id = contentId ? `Content-ID: ${contentId}\r\n` : '';
  return `Content-Type: application/http\r\n${id}\r\nHTTP/1.1 ${status}\r\n${head}\r\n${body === undefined ? '' : JSON.stringify(body)}`;
}

describe('toODataFilter', () => {
  const fields = { name: 'string', amount: 'number', shipped: 'date', created: 'datetime', id: 'guid' } as const;
  const cases: [string, data.FilterExpression, string][] = [
    ['text without case, lowered in the locale', where('city', '=', 'İstanbul'), "tolower(city) eq 'istanbul'"],
    ['case-sensitive text, quotes doubled', where('name', '=', "O'Brien", true), "name eq 'O''Brien'"],
    ['numbers', where('amount', '>=', 100), 'amount ge 100'],
    ['between with an open end', where('amount', 'between', [10, null]), 'amount ge 10'],
    ['between', where('amount', 'between', [10, 20]), '(amount ge 10 and amount le 20)'],
    ['between with no ends keeps non-empty values', where('amount', 'between', [null, null]), 'amount ne null'],
    ['in', where('amount', 'in', [1, 2]), '(amount eq 1 or amount eq 2)'],
    ['notin keeps empty values; nested paths', where('customer.name', 'notin', ['A', null]), "(tolower(customer/name) ne 'a' and customer/name ne null)"],
    ['contains', where('name', 'contains', 'Ab'), "contains(tolower(name),'ab')"],
    ['notcontains keeps empty values', where('name', 'notcontains', 'Ab'), "(name eq null or not contains(tolower(name),'ab'))"],
    ['blank text is null, empty or spaces', where('name', 'isblank'), "(name eq null or trim(name) eq '')"],
    ['= with an empty value is blank', where('note', '=', ''), "(note eq null or trim(note) eq '')"],
    ['blank of other types is null', where('amount', '<>', null), 'amount ne null'],
    ['date fields are days', where('shipped', '=', new Date(2024, 2, 5, 23, 30)), 'shipped eq 2024-03-05'],
    ['datetime fields are moments', where('created', '<', new Date(Date.UTC(2024, 2, 5, 10))), 'created lt 2024-03-05T10:00:00.000Z'],
    ['GUIDs have no quotes', where('id', '=', '0F8FAD5B-D9CB-469F-A165-70867728950E'), 'id eq 0F8FAD5B-D9CB-469F-A165-70867728950E'],
    [
      'groups and not',
      not(or(where('amount', '<', 5), and(where('name', 'startswith', 'a'), where('name', 'endswith', 'z')))!),
      "not (amount lt 5 or (startswith(tolower(name),'a') and endswith(tolower(name),'z')))",
    ],
    ['an empty text value drops out', and(where('name', 'contains', ''), where('amount', '>', 1))!, 'amount gt 1'],
    ['in with no values keeps nothing', where('amount', 'in', []), 'false'],
    ['a part that keeps everything decides an or', or(where('amount', 'in', []), where('name', 'contains', ''))!, 'true'],
    ['not flips a constant', not(where('amount', 'notin', [])), 'false'],
    ['< with no value keeps nothing', where('amount', '<', null), 'false'],
    ['none keeps nothing', none(), 'false'],
    ['none decides an and, drops out of an or', or(and(where('amount', '>', 1), none()), where('name', 'contains', 'a'))!, "contains(tolower(name),'a')"],
  ];

  it.each(cases)('%s', (_, filter, expected) => {
    expect(toODataFilter(filter, { fields, locale: 'tr' })).toBe(expected);
  });

  it('compares text with case when ignoreCase is false', () => {
    expect(toODataFilter(where('city', '=', 'İstanbul'), { ignoreCase: false })).toBe("city eq 'İstanbul'");
  });

  it('rejects values the field type cannot hold', () => {
    expect(() => toODataFilter(where('id', '=', 'nope'), { fields })).toThrow(/not a GUID/);
    expect(() => toODataFilter(where('amount', '=', 'ten'), { fields })).toThrow(/not a number/);
  });
});

describe('ODataAdapter', () => {
  it('loads with query options and reads value and @odata.count', async () => {
    const service = fakeService(() => json({ '@odata.context': 'https://host/odata/$metadata#Orders', '@odata.count': 42, value: [{ id: 1 }, { id: 2 }] }));
    const result = await make(service).load({
      filter: and(where('customer', 'contains', 'ada'), where('amount', '>', 5)),
      sort: [{ field: 'amount', dir: 'desc' }, { field: 'customer.name', dir: 'asc' }],
      skip: 20,
      take: 10,
      count: true,
      select: ['id', 'amount'],
      expand: ['customer', 'items.product', 'items.unit'],
      params: { $search: 'blue' },
    });

    expect(result).toEqual({ rows: [{ id: 1 }, { id: 2 }], total: 42 });
    const call = service.calls[0];
    expect(call.path).toBe('/odata/Orders');
    expect(call.query).toEqual({
      $filter: "contains(tolower(customer),'ada') and amount gt 5",
      $orderby: 'amount desc,customer/name',
      $skip: '20',
      $top: '10',
      $count: 'true',
      $select: 'id,amount',
      $expand: 'customer,items($expand=product,unit)',
      $search: 'blue',
    });
    expect(call.url).toContain("$filter=contains(tolower(customer),'ada')%20and%20amount%20gt%205");
    // A read carries no custom header, so a browser sends it without a CORS preflight.
    expect(call.headers.has('odata-version')).toBe(false);
    expect(call.headers.get('accept')).toBe('application/json');
  });

  it('computes summaries on the service with aggregation, or in memory without it', async () => {
    const service = fakeService((call) => {
      if (call.query.$apply === 'aggregate($count as s0)') return json({ value: [{ s0: 3 }] });
      if (call.query.$apply) return json({ value: [{ '@odata.id': null, s0: '150.5', s1: 3, s2: null, s3: '2024-01-02' }] });
      return json({ value: [{ id: 1, amount: 2 }, { id: 2, amount: 3 }] });
    });
    const summary: data.SummaryItem[] = [
      { type: 'sum', field: 'amount' },
      { type: 'count' },
      { type: 'avg', field: 'amount' },
      { type: 'max', field: 'shipped' },
    ];
    const totals = await make(service, { aggregation: true }).load({ filter: where('amount', '>', 5), summary, take: 0 });
    expect(service.calls).toHaveLength(1);
    expect(service.calls[0].query).toEqual({ $apply: 'filter(amount gt 5)/aggregate(amount with sum as s0,$count as s1,amount with average as s2,shipped with max as s3)' });
    expect(totals).toEqual({ rows: [], summary: [150.5, 3, null, '2024-01-02'] });

    service.calls.length = 0;
    const page = await make(service, { aggregation: true }).load({ summary: [{ type: 'count' }], take: 2 });
    expect(service.calls.map((c) => c.query)).toEqual([{ $top: '2' }, { $apply: 'aggregate($count as s0)' }]);
    expect(page.summary).toEqual([3]);

    service.calls.length = 0;
    const inMemory = await make(service).load({ summary: [{ type: 'sum', field: 'amount' }], take: 1 });
    expect(service.calls.map((c) => c.query)).toEqual([{}]);
    expect(inMemory).toEqual({ rows: [{ id: 1, amount: 2 }], summary: [5] });
  });

  it('follows @odata.nextLink until it has the rows asked for', async () => {
    const pages: Record<string, unknown> = {
      '': { '@odata.count': 5, value: [{ id: 1 }, { id: 2 }], '@odata.nextLink': 'https://host/odata/Orders?$skiptoken=2' },
      '2': { value: [{ id: 3 }, { id: 4 }], '@odata.nextLink': 'Orders?$skiptoken=4' },
      '4': { value: [{ id: 5 }] },
    };
    const service = fakeService((call) => json(pages[call.query.$skiptoken ?? '']));

    const all = await make(service).load({ count: true });
    expect(all).toEqual({ rows: [1, 2, 3, 4, 5].map((id) => ({ id })), total: 5 });
    expect(service.calls[2].url).toBe('https://host/odata/Orders?$skiptoken=4');

    service.calls.length = 0;
    const three = await make(service).load({ take: 3 });
    expect(three.rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(service.calls).toHaveLength(2);

    const firstPage = await make(service, { followNextLink: false }).load();
    expect(firstPage.rows).toHaveLength(2);
  });

  it('counts with $top=0', async () => {
    const service = fakeService(() => json({ '@odata.count': 7, value: [] }));
    expect(await make(service).count({ filter: where('amount', '>', 1) })).toBe(7);
    expect(service.calls[0].query).toMatchObject({ $top: '0', $count: 'true', $filter: 'amount gt 1' });
  });

  it('finds rows by key in each key format', async () => {
    const service = fakeService((call) =>
      call.path.includes('(404)') ? json({ error: { code: '', message: 'Not found' } }, 404) : json({ '@odata.context': 'https://host/odata/$metadata#Orders/$entity', id: 5 }),
    );
    expect(await make(service).byKey(5, { select: ['id'], expand: ['customer'] })).toEqual({ id: 5 });
    expect(service.calls[0].path).toBe('/odata/Orders(5)');
    expect(service.calls[0].query).toEqual({ $select: 'id', $expand: 'customer' });
    expect(await make(service).byKey(404)).toBeUndefined();

    const byCode = new ODataAdapter<Order, string>({ url: 'https://host/odata/Orders', key: 'code', fetch: service.fetch });
    await byCode.byKey("A'1 b");
    expect(service.calls.at(-1)!.url).toBe("https://host/odata/Orders('A''1%20b')");

    const lines = new ODataAdapter({ url: 'https://host/odata/Lines/', key: ['orderId', 'line'], fetch: service.fetch });
    await lines.byKey({ orderId: 7, line: 2 });
    expect(service.calls.at(-1)!.path).toBe('/odata/Lines(orderId=7,line=2)');

    const byGuid = new ODataAdapter<Order, string>({ url: 'https://host/odata/Orders', key: 'id', fields: { id: 'guid' }, fetch: service.fetch });
    await byGuid.byKey('0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(service.calls.at(-1)!.path).toBe('/odata/Orders(0f8fad5b-d9cb-469f-a165-70867728950e)');
    await expect(byGuid.byKey('nope')).rejects.toMatchObject({ code: 'MJD302', operation: 'byKey' });
  });

  it('inserts, updates and removes with the etag of the original row', async () => {
    const service = fakeService((call) => {
      if (call.method === 'POST') return json({ '@odata.context': 'x', '@odata.etag': 'W/"1"', id: 100, ...JSON.parse(call.body!) }, 201);
      if (call.method === 'PATCH') return new Response(null, { status: 204, headers: { ETag: 'W/"2"' } });
      if (call.method === 'DELETE' && call.headers.get('if-match') === 'W/"2"') return new Response(null, { status: 204 });
      return json({ error: { code: 'Conflict', message: 'Changed by someone else' } }, 412);
    });
    const adapter = make(service, { fields: { shipped: 'date' } });

    const saved = await adapter.insert({ customer: 'Ada', amount: 5, shipped: new Date(2024, 2, 5, 23, 30), '@odata.etag': 'old' });
    expect(saved).toEqual({ '@odata.etag': 'W/"1"', id: 100, customer: 'Ada', amount: 5, shipped: '2024-03-05' });
    const post = service.calls[0];
    expect([post.method, post.path, post.headers.get('prefer'), post.headers.get('content-type'), post.headers.get('odata-version')]).toEqual([
      'POST',
      '/odata/Orders',
      'return=representation',
      'application/json',
      '4.0',
    ]);
    expect(JSON.parse(post.body!)).toEqual({ customer: 'Ada', amount: 5, shipped: '2024-03-05' });

    const updated = await adapter.update(100, { amount: 6 }, { original: saved });
    expect(updated).toEqual({ amount: 6, '@odata.etag': 'W/"2"' });
    expect(service.calls[1]).toMatchObject({ method: 'PATCH', path: '/odata/Orders(100)', body: '{"amount":6}' });
    expect(service.calls[1].headers.get('if-match')).toBe('W/"1"');

    await expect(adapter.remove(100, { original: { ...saved, '@odata.etag': 'W/"1"' } })).rejects.toMatchObject({
      code: 'MJD205',
      kind: 'conflict',
      plainMessage: 'Changed by someone else',
    });
    await adapter.remove(100, { original: { ...saved, ...updated } });
    expect(service.calls.at(-1)!.headers.get('if-match')).toBe('W/"2"');

    await make(service, { returnSavedRow: false }).insert({ customer: 'B' });
    expect(service.calls.at(-1)!.headers.has('prefer')).toBe(false);
  });

  it('reads the OData error body into a message and messages by field', async () => {
    const service = fakeService(() =>
      json({ error: { code: 'Invalid', message: 'Check the values', details: [{ target: 'amount', message: 'Must be positive' }, { target: 'amount', message: 'Too big' }] } }, 400),
    );
    await expect(make(service).update(1, { amount: -1 })).rejects.toMatchObject({
      code: 'MJD202',
      plainMessage: 'Check the values',
      fields: { amount: 'Must be positive Too big' },
    });
  });

  it('changes rows through readRow and rejects an answer without value', async () => {
    const service = fakeService((call) =>
      call.path.endsWith('(1)') ? json({ id: 1, shipped: '2024-03-05' }) : json({ value: [{ id: 1, shipped: '2024-03-05T00:00:00Z' }] }),
    );
    const readRow = (row: Record<string, unknown>) => ({ ...row, shipped: new Date(row.shipped as string) }) as Order;
    const adapter = make(service, { readRow });
    expect((await adapter.load()).rows[0].shipped).toBeInstanceOf(Date);
    expect((await adapter.byKey(1))!.shipped).toBeInstanceOf(Date);

    const broken = make(fakeService(() => json({ items: [] })));
    await expect(broken.load()).rejects.toMatchObject({ code: 'MJD104', plainMessage: 'The answer could not be read: no "value" array.' });
  });

  it('saves many changes in one $batch request, one outcome per change', async () => {
    const service = fakeService(() =>
      batchAnswer('batchresponse_1', [
        httpPart('201 Created', { 'Content-Type': 'application/json' }, { '@odata.etag': 'W/"1"', id: 50, customer: 'x' }),
        httpPart('412 Precondition Failed', { 'Content-Type': 'application/json' }, { error: { code: '', message: 'Changed' } }),
        httpPart('204 No Content'),
      ]),
    );
    const outcomes = await make(service, { batch: true }).save([
      { type: 'insert', data: { customer: 'x' } },
      { type: 'update', key: 1, data: { amount: 2 }, original: { id: 1, customer: 'a', amount: 1, '@odata.etag': 'W/"7"' } },
      { type: 'remove', key: 2 },
    ]);

    expect(service.calls).toHaveLength(1);
    const call = service.calls[0];
    expect(call.url).toBe('https://host/odata/$batch');
    expect(call.headers.get('content-type')).toMatch(/^multipart\/mixed; boundary=batch_/);
    expect(call.headers.get('prefer')).toBe('odata.continue-on-error');
    const body = call.body!;
    expect(body).toContain('POST https://host/odata/Orders HTTP/1.1\r\nContent-Type: application/json');
    expect(body).toContain('{"customer":"x"}');
    expect(body).toContain('PATCH https://host/odata/Orders(1) HTTP/1.1');
    expect(body).toContain('If-Match: W/"7"');
    expect(body).toContain('DELETE https://host/odata/Orders(2) HTTP/1.1');
    expect(body.trimEnd().endsWith('--')).toBe(true);

    expect(outcomes).toMatchObject([
      { ok: true, key: 50, row: { id: 50, customer: 'x', '@odata.etag': 'W/"1"' } },
      { ok: false, error: { code: 'MJD205', operation: 'update', plainMessage: 'Changed' } },
      { ok: true, key: 2 },
    ]);
  });

  it('sends an all-or-nothing change set and reads both kinds of answer', async () => {
    let fail = false;
    const service = fakeService(() =>
      fail
        ? batchAnswer('b', [httpPart('400 Bad Request', { 'Content-Type': 'application/json' }, { error: { code: '', message: 'Amount is required' } })])
        : batchAnswer('b', [
            [
              'Content-Type: multipart/mixed; boundary=cs',
              '',
              '--cs',
              httpPart('204 No Content', {}, undefined, '2'),
              '--cs',
              httpPart('201 Created', { 'Content-Type': 'application/json' }, { id: 60, customer: 'y' }, '1'),
              '--cs--',
            ].join('\r\n'),
          ]),
    );
    const adapter = make(service, { batch: { allOrNothing: true, url: 'https://host/odata/$batch' } });
    const changes = [
      { type: 'insert' as const, data: { customer: 'y' } },
      { type: 'remove' as const, key: 3 },
    ];

    expect(await adapter.save(changes)).toMatchObject([
      { ok: true, key: 60 },
      { ok: true, key: 3 },
    ]);
    expect(service.calls[0].body).toMatch(/Content-Type: multipart\/mixed; boundary=changeset_\w+\r\n\r\n--changeset_\w+\r\n/);
    expect(service.calls[0].headers.has('prefer')).toBe(false);

    fail = true;
    expect(await adapter.save(changes)).toMatchObject([
      { ok: false, error: { code: 'MJD202', plainMessage: 'Amount is required' } },
      { ok: false, error: { code: 'MJD202' } },
    ]);
  });
});
