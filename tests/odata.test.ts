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

  it('writes conditions on collections with any(): one value passes, none with a negative operator', () => {
    const lists = (filter: data.FilterExpression) => toODataFilter(filter, { fields: { sizes: 'number' }, locale: 'tr', collections: ['tags', 'sizes'] });
    expect(lists(where('tags', '=', 'MAVİ'))).toBe("tags/any(x: tolower(x) eq 'mavi')");
    expect(lists(where('tags', '<>', 'mavi'))).toBe("not tags/any(x: tolower(x) eq 'mavi')");
    expect(lists(where('tags', 'in', ['a', 'b']))).toBe("tags/any(x: (tolower(x) eq 'a' or tolower(x) eq 'b'))");
    expect(lists(where('tags', 'notin', ['a']))).toBe("not tags/any(x: tolower(x) eq 'a')");
    expect(lists(where('tags', 'notcontains', 'kır'))).toBe("not tags/any(x: contains(tolower(x),'kır'))");
    expect(lists(where('sizes', 'between', [38, 42]))).toBe('sizes/any(x: (x ge 38 and x le 42))');
    expect(lists(where('sizes', 'isblank'))).toBe('not sizes/any(x: x ne null)');
    expect(lists(where('tags', '<>', ''))).toBe("tags/any(x: (x ne null and trim(x) ne ''))");
    expect(lists(where('tags', 'contains', ''))).toBe('true');
    expect(lists(where('tags', 'in', []))).toBe('false');
    expect(lists(where('tags', 'notin', []))).toBe('true');
    expect(lists(and(where('tags', '=', 'a'), where('name', '=', 'b'))!)).toBe("tags/any(x: tolower(x) eq 'a') and tolower(name) eq 'b'");
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

describe('ODataAdapter pivots', () => {
  type Sale = { id: number; region: string; city: string; day: string; amount: number; customer?: { country: string } };
  const sales: Sale[] = [
    { id: 1, region: 'North', city: 'Oslo', day: '2023-06-01', amount: 30, customer: { country: 'TR' } },
    { id: 2, region: 'North', city: 'Bergen', day: '2024-02-03', amount: 10, customer: { country: 'DE' } },
    { id: 3, region: 'South', city: 'Rome', day: '2024-08-15', amount: 20, customer: { country: 'TR' } },
  ];
  const sales$ = (service: ReturnType<typeof fakeService>, aggregation: data.ODataAdapterOptions<Sale, number>['aggregation'], more: Partial<data.ODataAdapterOptions<Sale, number>> = {}) =>
    new ODataAdapter<Sale, number>({ url: 'https://host/odata/Sales', key: 'id', locale: 'en-US', fields: { day: 'date' }, fetch: service.fetch, aggregation, ...more });
  /** Answers each `$apply` from `groups`, and a read without one with the rows. */
  const serviceOf = (groups: Record<string, unknown[]>) => fakeService((call) => (call.query.$apply ? json({ value: groups[call.query.$apply] ?? [] }) : json({ value: sales })));
  const keys = (member: data.PivotMember) => member.children?.map((m) => m.key);
  const measures: data.PivotMeasure[] = [{ type: 'sum', field: 'amount' }, { type: 'count' }, { type: 'countDistinct', field: 'city' }];
  const values = 'aggregate($count as _n,amount with sum as _m0,city with countdistinct as _m2)';

  it('asks the service with $apply for each pair of depths of the axes', async () => {
    const service = serviceOf({
      [`filter(amount gt 5)/${values}`]: [{ '@odata.id': null, _n: 3, _m0: '60', _m2: 3 }],
      [`filter(amount gt 5)/groupby((customer/country),${values})`]: [
        { customer: { country: 'TR' }, _n: 2, _m0: 50, _m2: 2 },
        { customer: { country: 'DE' }, _n: 1, _m0: 10, _m2: 1 },
      ],
      [`filter(amount gt 5)/groupby((region),${values})`]: [
        { region: 'South', _n: 1, _m0: 20, _m2: 1 },
        { region: 'North', _n: 2, _m0: 40, _m2: 2 },
      ],
      [`filter(amount gt 5)/groupby((region,customer/country),${values})`]: [
        { region: 'North', customer: { country: 'TR' }, _n: 1, _m0: 30, _m2: 1 },
        { region: 'North', customer: { country: 'DE' }, _n: 1, _m0: 10, _m2: 1 },
        { region: 'South', customer: { country: 'TR' }, _n: 1, _m0: 20, _m2: 1 },
      ],
    });
    const adapter = sales$(service, true);
    expect(adapter.capabilities.pivot).toBe(true);
    const p = await adapter.loadPivot({ filter: where('amount', '>', 5), rows: [{ field: 'region' }], columns: [{ field: 'customer.country' }], measures });
    expect(service.calls).toHaveLength(4);
    expect([keys(p.rows), keys(p.columns)]).toEqual([['North', 'South'], ['DE', 'TR']]);
    const [north] = p.rows.children!;
    const [de, tr] = p.columns.children!;
    expect([p.values(north, tr), p.values(north, de), p.values(p.rows.children![1], de)]).toEqual([[30, 1, 1], [10, 1, 1], undefined]);
    expect([p.values(p.rows, p.columns), p.rows.count, tr.count]).toEqual([[60, 3, 3], 3, 2]);
  });

  it('computes intervals with compute and the children of the expanded members only', async () => {
    const sum = 'aggregate($count as _n,amount with sum as _m0)';
    const service = serviceOf({
      [`compute(year(day) as _r0)/groupby((_r0),${sum})`]: [
        { _r0: 2023, _n: 1, _m0: 30 },
        { _r0: 2024, _n: 2, _m0: 30 },
      ],
      [`compute(year(day) as _r0,(month(day) add 2) div 3 as _r1)/filter(_r0 eq 2024)/groupby((_r0,_r1),${sum})`]: [
        { _r0: 2024, _r1: 3, _n: 1, _m0: 20 },
        { _r0: 2024, _r1: 1, _n: 1, _m0: 10 },
      ],
    });
    const rows: data.PivotLevel[] = [{ field: 'day', interval: 'year' }, { field: 'day', interval: 'quarter' }];
    const p = await sales$(service, { compute: true }).loadPivot({ rows, measures: [{ type: 'sum', field: 'amount' }], expandedRows: [[2024]] });
    expect(service.calls.map((c) => c.query.$apply)).toEqual([sum, `compute(year(day) as _r0)/groupby((_r0),${sum})`, `compute(year(day) as _r0,(month(day) add 2) div 3 as _r1)/filter(_r0 eq 2024)/groupby((_r0,_r1),${sum})`]);
    expect(p.rows.children!.map((m) => [m.key, keys(m)])).toEqual([[2023, undefined], [2024, [1, 3]]]);

    service.calls.length = 0;
    await sales$(service, { compute: true }).loadPivot({
      rows: [{ field: 'day', interval: 'date' }, { field: 'region' }],
      columns: [{ field: 'amount', interval: 100 }],
      expandedRows: [['2024-02-03'], ['2024-08-15']],
    });
    expect(service.calls.map((c) => c.query.$apply)).toContain(
      "compute(date(day) as _r0,floor(amount div 100.0) mul 100 as _c0)/filter((_r0 eq 2024-02-03) or (_r0 eq 2024-08-15))/groupby((_r0,region,_c0),aggregate($count as _n))",
    );
  });

  it('groups the rows in memory when the pivot needs it', async () => {
    const service = serviceOf({});
    const sum = { type: 'sum', field: 'amount' } as const;
    const median = { type: 'custom' as const, field: 'amount', start: () => 0, add: (s: number, v: unknown) => s + (v as number), result: (s: number) => s };
    const cases: data.PivotLoadOptions<Sale>[] = [
      { rows: [{ field: 'day', interval: 'year' }], measures: [sum] },
      { rows: [{ field: 'day', interval: 'dayOfWeek' }], measures: [sum] },
      { rows: [{ field: 'region', value: (s) => s.region.toUpperCase() }], measures: [sum] },
      { rows: [{ field: 'region' }], measures: [median] },
    ];
    const results = [];
    for (const [i, options] of cases.entries()) results.push(await sales$(service, i === 1 ? { compute: true } : true).loadPivot(options));
    expect(service.calls.every((c) => c.query.$apply === undefined)).toBe(true);
    expect(results.map((p) => [keys(p.rows), p.values(p.rows, p.columns)])).toEqual([
      [[2023, 2024], [60]],
      [[4, 6], [60]],
      [['NORTH', 'SOUTH'], [60]],
      [['North', 'South'], [60]],
    ]);
    // Without aggregation every pivot is grouped in memory.
    expect(sales$(service, undefined).capabilities.pivot).toBe(false);
  });

  it('keeps members with a filter of date functions, and in memory where no function tells them', async () => {
    const service = serviceOf({});
    const adapter = sales$(service, true);
    const keep: data.PivotKeep<Sale>[] = [
      { field: 'day', intervals: ['year', 'quarter'], paths: [[2024], [2023, 2]] },
      { field: 'amount', intervals: [25], paths: [[0], [null]], type: 'exclude' },
    ];
    await adapter.loadPivot({ rows: [{ field: 'region' }], measures: [{ type: 'count' }], keep });
    expect(service.calls[0].query.$apply).toBe(
      'filter(((year(day) eq 2024) or (year(day) eq 2023 and (month(day) add 2) div 3 eq 2)) and (not ((floor(amount div 25.0) mul 25 eq 0) or (amount eq null))))/aggregate($count as _n)',
    );
    // Without intervals, keys are compared as a filter compares them.
    service.calls.length = 0;
    await adapter.loadPivot({ measures: [{ type: 'count' }], keep: [{ field: 'region', paths: [['North'], [null]] }] });
    expect(service.calls[0].query.$apply).toBe(`filter(${data.toODataFilter(data.or(data.where('region', '=', 'North'), data.where('region', 'isblank'))!)})/aggregate($count as _n)`);
    // A keep's filter joins its members with `or`, and stands alone without them.
    service.calls.length = 0;
    await adapter.loadPivot({ measures: [{ type: 'count' }], keep: [{ field: 'day', intervals: ['year'], paths: [[2024]], filter: data.where('amount', '>', 15), type: 'exclude' }] });
    await adapter.loadPivot({ measures: [{ type: 'count' }], keep: [{ field: 'amount', paths: [], filter: data.where('amount', '>', 15) }] });
    expect(service.calls.map((c) => c.query.$apply)).toEqual(['filter(not ((year(day) eq 2024) or (amount gt 15)))/aggregate($count as _n)', 'filter(amount gt 15)/aggregate($count as _n)']);
    // No OData function tells the day of the week, nor reads a computed value: the rows are kept in memory.
    service.calls.length = 0;
    const weekday = await adapter.loadPivot({ rows: [{ field: 'region' }], measures: [{ type: 'count' }], keep: [{ field: 'day', intervals: ['dayOfWeek'], paths: [[6]] }] });
    const computed = await adapter.loadPivot({ rows: [{ field: 'region' }], measures: [{ type: 'count' }], keep: [{ field: 'big', value: (s) => s.amount > 15, paths: [[true]] }] });
    expect(service.calls.every((c) => c.query.$apply === undefined)).toBe(true);
    // Saturday: 3 February 2024, in Bergen.
    expect([keys(weekday.rows), keys(computed.rows)]).toEqual([['North'], ['North', 'South']]);
  });

  it('sends its reads in one $batch with aggregation.batch, and fails with an answer that failed', async () => {
    const ok = (body: unknown, id: string) => httpPart('200 OK', { 'Content-Type': 'application/json' }, body, id);
    let second = ok({ value: [{ region: 'North', _n: 3 }] }, '2');
    const service = fakeService(() => batchAnswer('b', [second, ok({ value: [{ _n: 3 }] }, '1')]));
    const adapter = sales$(service, { batch: true }, { batch: { url: 'https://host/odata/$batch' } });
    const p = await adapter.loadPivot({ rows: [{ field: 'region' }], params: { tenant: 'a' } });
    expect(service.calls).toHaveLength(1);
    const call = service.calls[0];
    expect([call.method, call.url]).toEqual(['POST', 'https://host/odata/$batch']);
    expect(call.body).toContain('GET https://host/odata/Sales?$apply=aggregate($count%20as%20_n)&tenant=a HTTP/1.1');
    expect(call.body).toContain('GET https://host/odata/Sales?$apply=groupby((region),aggregate($count%20as%20_n))&tenant=a HTTP/1.1');
    expect([keys(p.rows), p.rows.count]).toEqual([['North'], 3]);

    second = httpPart('400 Bad Request', { 'Content-Type': 'application/json' }, { error: { code: '', message: 'No groupby here' } }, '2');
    await expect(adapter.loadPivot({ rows: [{ field: 'region' }] })).rejects.toMatchObject({ code: 'MJD202', plainMessage: 'No groupby here' });
    const broken = sales$(fakeService(() => json({ rows: [] })), true);
    await expect(broken.loadPivot({ rows: [{ field: 'region' }] })).rejects.toMatchObject({ code: 'MJD104' });
  });

  it('counts distinct values on the service', async () => {
    const service = fakeService(() => json({ value: [{ s0: '2' }] }));
    const result = await sales$(service, true).load({ summary: [{ type: 'countDistinct', field: 'city' }], take: 0 });
    expect([service.calls[0].query.$apply, result.summary]).toEqual(['aggregate(city with countdistinct as s0)', [2]]);
  });
});

describe('ODataAdapter pivot windows', () => {
  type Sale = { id: number; region: string | null; city: string; day: string; amount: number | null };
  const sales: Sale[] = [
    { id: 1, region: 'North', city: 'Oslo', day: '2023-06-01', amount: 30 },
    { id: 2, region: 'North', city: 'Bergen', day: '2024-02-03', amount: 10 },
    { id: 3, region: 'South', city: 'Rome', day: '2024-08-15', amount: 20 },
    { id: 4, region: null, city: 'Nowhere', day: '2024-01-01', amount: 5 },
  ];
  const sales$ = (service: ReturnType<typeof fakeService>, aggregation: data.ODataAdapterOptions<Sale, number>['aggregation'], more: Partial<data.ODataAdapterOptions<Sale, number>> = {}) =>
    new ODataAdapter<Sale, number>({ url: 'https://host/odata/Sales', key: 'id', locale: 'en-US', fields: { day: 'date' }, fetch: service.fetch, aggregation, ...more });
  /** Answers by `$apply` and the query options after it; a read without `$apply` with the rows. */
  const serviceOf = (answers: Record<string, unknown>) =>
    fakeService((call) => {
      const key = [call.query.$apply, call.query.$orderby, call.query.$skip, call.query.$top].filter((part) => part !== undefined).join(' | ');
      return call.query.$apply ? json(answers[key] ?? { value: [] }) : json({ value: sales });
    });
  const queries = (service: ReturnType<typeof fakeService>) =>
    service.calls.map((c) => [c.query.$apply, c.query.$orderby, c.query.$skip, c.query.$top, c.query.$count].filter((part) => part !== undefined).join(' | '));
  const sum = 'aggregate($count as _n,amount with sum as _m0)';
  const region = { field: 'region' } as const;
  const keysOf = (r: data.PivotMembersResult) => r.slices.map((s) => [s.total, s.members.map((m) => [m.key, m.count, ...m.values])]);

  it('pages the members on the service in their order, the empty one last on its own', async () => {
    const service = serviceOf({
      [`filter(region ne null)/groupby((region),${sum}) | region asc | 1 | 3`]: { '@odata.count': 3, value: [{ region: 'North', _n: 2, _m0: 40 }, { region: 'South', _n: 1, _m0: 20 }] },
      [`filter(region eq null)/${sum}`]: { value: [{ _n: 1, _m0: 5 }] },
    });
    const adapter = sales$(service, true);
    expect(adapter.capabilities.pivotWindow).toBe(true);
    const r = await adapter.loadPivotMembers({ levels: [region], slices: [{ parent: [], skip: 1, take: 3 }], measures: [{ type: 'sum', field: 'amount' }] });
    expect(queries(service)).toEqual([`filter(region ne null)/groupby((region),${sum}) | region asc | 1 | 3 | true`, `filter(region eq null)/${sum}`]);
    expect(keysOf(r)).toEqual([[4, [['North', 2, 40], ['South', 1, 20], [null, 1, 5]]]]);
    // A service with no rows without a value has no empty member.
    const none = await sales$(serviceOf({ [`filter(region ne null)/groupby((region),${sum}) | region asc | 1`]: { '@odata.count': 0, value: [] } }), true).loadPivotMembers({
      levels: [region],
      slices: [{ parent: [], skip: 0, take: 1 }],
      measures: [{ type: 'sum', field: 'amount' }],
    });
    expect(keysOf(none)).toEqual([[0, []]]);
  });

  it('gives the children of a member of computed levels, with the number of their own children', async () => {
    const compute = 'compute(year(day) as _r0,(month(day) add 2) div 3 as _r1)';
    const service = serviceOf({
      [`${compute}/filter(_r0 eq 2024)/filter(_r1 ne null)/groupby((_r0,_r1),aggregate($count as _n)) | _r1 desc`]: { '@odata.count': 2, value: [{ _r0: 2024, _r1: 3, _n: 1 }, { _r0: 2024, _r1: 1, _n: 2 }] },
      'compute(year(day) as _r0,(month(day) add 2) div 3 as _r1,month(day) as _r2)/filter(_r0 eq 2024)/groupby((_r0,_r1,_r2))/groupby((_r0,_r1),aggregate($count as _c))': {
        value: [{ _r0: 2024, _r1: 1, _c: 2 }, { _r0: 2024, _r1: 3, _c: 1 }],
      },
    });
    const levels: data.PivotLevel[] = [{ field: 'day', interval: 'year' }, { field: 'day', interval: 'quarter', dir: 'desc' }, { field: 'day', interval: 'month' }];
    const r = await sales$(service, { compute: true }).loadPivotMembers({ levels, slices: [{ parent: [2024] }], childCounts: true });
    expect(r.slices[0].members.map((m) => [m.path, m.count, m.childCount])).toEqual([
      [[2024, 3], 1, 1],
      [[2024, 1], 2, 2],
    ]);
    expect(queries(service)[1]).toBe(`${compute}/filter(_r0 eq 2024)/filter(_r1 eq null)/aggregate($count as _n)`);
  });

  it('orders by a measure in groups its value tells apart, the empty member placed by its value; by a measure in a member of the other axis here', async () => {
    const listed = `filter(region ne null)/groupby((region),${sum})`;
    const service = serviceOf({
      // Counted first: a sum above, at and below 0, and the empty member.
      [`${listed}/filter(_m0 gt 0) | 0`]: { '@odata.count': 2, value: [] },
      [`${listed}/filter(_m0 eq 0 or _m0 eq null) | 0`]: { '@odata.count': 2, value: [] },
      [`${listed}/filter(_m0 lt 0) | 0`]: { '@odata.count': 0, value: [] },
      [`filter(region eq null)/${sum}`]: { value: [{ _n: 1, _m0: 5 }] },
      // Then the pages the part reaches.
      [`${listed}/filter(_m0 gt 0) | _m0 desc,region desc | 2`]: { value: [{ region: 'North', _n: 2, _m0: 40 }, { region: 'South', _n: 1, _m0: 20 }] },
      [`${listed}/filter(_m0 eq 0 or _m0 eq null) | region desc | 2`]: { value: [{ region: 'West', _n: 1, _m0: null }, { region: 'East', _n: 1, _m0: 0 }] },
      [`groupby((region),${sum})`]: { value: [{ region: 'South', _n: 1, _m0: 20 }, { region: 'North', _n: 2, _m0: 40 }, { region: null, _n: 1, _m0: 5 }] },
      'compute(year(day) as _c0)/filter(_c0 eq 2024)/groupby((region),aggregate(amount with sum as _s))': { value: [{ region: 'South', _s: 20 }, { region: 'North', _s: 10 }] },
    });
    const adapter = sales$(service, { compute: true });
    const measures: data.PivotMeasure[] = [{ type: 'sum', field: 'amount' }];
    const atTotal = await adapter.loadPivotMembers({ levels: [{ ...region, dir: 'desc' }], slices: [{ parent: [], skip: 1 }], measures, sortBySummary: { measure: 0 } });
    // North 40, South 20, the empty region 5, then the sums of 0 (an empty sum is 0) in the order of their names.
    expect(keysOf(atTotal)).toEqual([[5, [['South', 1, 20], [null, 1, 5], ['West', 1, 0], ['East', 1, 0]]]]);
    expect(service.calls.filter((c) => c.query.$top !== '0' && c.query.$apply.startsWith(listed))).toHaveLength(2);
    // In 2024: North 10, South 20; the empty region has no row then and goes last.
    const in2024 = await adapter.loadPivotMembers({ levels: [region], slices: [{ parent: [] }], measures, sortBySummary: { measure: 0, levels: [{ field: 'day', interval: 'year' }], path: [2024] } });
    expect(in2024.slices[0].members.map((m) => m.key)).toEqual(['North', 'South', null]);

    // On a tie, the empty member comes after the others, read one before the part to find its place.
    const tie = serviceOf({
      [`${listed}/filter(_m0 lt 0) | 0`]: { '@odata.count': 0, value: [] },
      [`${listed}/filter(_m0 eq 0 or _m0 eq null) | 0`]: { '@odata.count': 0, value: [] },
      [`${listed}/filter(_m0 gt 0) | 0`]: { '@odata.count': 3, value: [] },
      [`filter(region eq null)/${sum}`]: { value: [{ _n: 1, _m0: 20 }] },
      [`${listed}/filter(_m0 gt 0) | _m0 asc,region asc | 1 | 2`]: { value: [{ region: 'South', _n: 1, _m0: 20 }, { region: 'West', _n: 1, _m0: 30 }] },
    });
    const ties = await sales$(tie, true).loadPivotMembers({ levels: [region], slices: [{ parent: [], skip: 2, take: 2 }], measures, sortBySummary: { measure: 0 } });
    // Asc: East 10, South 20, the empty region 20, West 30: the part from 2 is the empty region and West.
    expect(keysOf(ties)).toEqual([[4, [[null, 1, 20], ['West', 1, 30]]]]);
  });

  it('counts children with groupby over groupby, by the depth of the members', async () => {
    const service = serviceOf({
      'groupby((region))/aggregate($count as _c)': { value: [{ _c: 3 }] },
      "filter((region eq 'North') or (region eq 'South'))/groupby((region,city))/groupby((region),aggregate($count as _c))": { value: [{ region: 'North', _c: 2 }, { region: 'South', _c: 1 }] },
    });
    const r = await sales$(service, true).loadPivotCounts({ levels: [region, { field: 'city' }], paths: [[], ['North'], ['South']] });
    expect([r.childCount([]), r.childCount(['North']), r.childCount(['South']), r.childCount(['West'])]).toEqual([3, 2, 1, 0]);
    expect(service.calls).toHaveLength(2);
  });

  it('leaves out the members whose measures are all empty with nonEmpty, filtered after they are aggregated', async () => {
    const avg = 'aggregate($count as _n,amount with average as _m0)';
    const listed = `filter(region ne null)/groupby((region),${avg})/filter(_m0 ne null)`;
    const cities = `groupby((region,city),${avg})/filter(_m0 ne null)`;
    const service = serviceOf({
      [`${listed} | region asc | 1`]: { '@odata.count': 2, value: [{ region: 'North', _n: 2, _m0: 20 }] },
      [`${cities}/groupby((region),aggregate($count as _c))`]: { value: [{ region: 'North', _c: 2 }, { region: 'South', _c: 1 }] },
      [`groupby((region),${avg})/filter(_m0 ne null)/aggregate($count as _c)`]: { value: [{ _c: 2 }] },
      [`filter(region eq 'North')/${cities}/groupby((region),aggregate($count as _c))`]: { value: [{ region: 'North', _c: 2 }] },
    });
    const adapter = sales$(service, true);
    const measures: data.PivotMeasure[] = [{ type: 'avg', field: 'amount' }];
    const levels: data.PivotLevel[] = [region, { field: 'city' }];
    const r = await adapter.loadPivotMembers({ levels, slices: [{ parent: [], take: 1 }], measures, childCounts: true, nonEmpty: true });
    // The empty region, no amount among its rows, is no record of the answer.
    expect(queries(service)).toEqual([`${listed} | region asc | 1 | true`, `filter(region eq null)/${avg}/filter(_m0 ne null)`, `${cities}/groupby((region),aggregate($count as _c))`]);
    expect([keysOf(r), r.slices[0].members[0].childCount]).toEqual([[[2, [['North', 2, 20]]]], 2]);
    service.calls.length = 0;
    const counts = await adapter.loadPivotCounts({ levels, paths: [[], ['North']], measures, nonEmpty: true });
    expect(queries(service)).toEqual([`groupby((region),${avg})/filter(_m0 ne null)/aggregate($count as _c)`, `filter(region eq 'North')/${cities}/groupby((region),aggregate($count as _c))`]);
    expect([counts.childCount([]), counts.childCount(['North'])]).toEqual([2, 2]);

    // A sum or a count always has a value: nothing is filtered.
    const both = 'aggregate($count as _n,amount with average as _m0,amount with sum as _m1)';
    const plain = serviceOf({ [`filter(region ne null)/groupby((region),${both}) | region asc`]: { '@odata.count': 0, value: [] } });
    await sales$(plain, true).loadPivotMembers({ levels, slices: [{ parent: [] }], measures: [...measures, { type: 'sum', field: 'amount' }], nonEmpty: true });
    await sales$(plain, true).loadPivotCounts({ levels, paths: [[]], measures: [...measures, { type: 'count' }], nonEmpty: true });
    expect(queries(plain)).toEqual([`filter(region ne null)/groupby((region),${both}) | region asc | true`, `filter(region eq null)/${both}`, 'groupby((region))/aggregate($count as _c)']);
  });

  it('asks for the crossings by pairs of depths, a long list of members in several reads', async () => {
    const service = serviceOf({
      [sum]: { value: [{ _n: 4, _m0: 65 }] },
      [`compute(year(day) as _c0)/filter(_c0 eq 2024)/groupby((_c0),${sum})`]: { value: [{ _c0: 2024, _n: 3, _m0: 35 }] },
      [`filter(region eq 'North')/groupby((region),${sum})`]: { value: [{ region: 'North', _n: 2, _m0: 40 }] },
      [`compute(year(day) as _c0)/filter(region eq 'North')/filter(_c0 eq 2024)/groupby((region,_c0),${sum})`]: { value: [{ region: 'North', _c0: 2024, _n: 1, _m0: 10 }] },
    });
    const adapter = sales$(service, { compute: true });
    const cells = await adapter.loadPivotCells({ rows: [region], columns: [{ field: 'day', interval: 'year' }], measures: [{ type: 'sum', field: 'amount' }], rowPaths: [[], ['North']], columnPaths: [[], [2024]] });
    expect(service.calls).toHaveLength(4);
    expect([cells.values([], []), cells.values([], [2024]), cells.values(['North'], []), cells.values(['North'], [2024]), cells.count(['North'], [2024])]).toEqual([[65], [35], [40], [10], 1]);
    service.calls.length = 0;
    const many = Array.from({ length: 200 }, (_, i) => [`Region ${i}`]);
    await adapter.loadPivotCells({ rows: [region], columns: [], measures: [], rowPaths: many, columnPaths: [[]] });
    expect(service.calls.length).toBeGreaterThan(1);
    expect(service.calls.every((c) => c.query.$apply.length < 1700)).toBe(true);
    expect(service.calls.map((c) => c.query.$apply.match(/region eq/g)!.length).reduce((a, b) => a + b)).toBe(200);
  });

  it('sends every read of a part in one $batch, and groups in memory what the service cannot', async () => {
    const ok = (body: unknown, id: string) => httpPart('200 OK', { 'Content-Type': 'application/json' }, body, id);
    const service = fakeService((call) =>
      call.method === 'POST' ? batchAnswer('b', [ok({ '@odata.count': 1, value: [{ region: 'North', _n: 2 }] }, '1'), ok({ value: [{ _n: 0 }] }, '2')]) : json({ value: sales }),
    );
    const adapter = sales$(service, { batch: true }, { batch: { url: 'https://host/odata/$batch' } });
    const r = await adapter.loadPivotMembers({ levels: [region], slices: [{ parent: [] }] });
    expect(service.calls).toHaveLength(1);
    expect(service.calls[0].body).toContain('GET https://host/odata/Sales?$apply=filter(region%20ne%20null)/groupby((region),aggregate($count%20as%20_n))&$orderby=region%20asc&$count=true HTTP/1.1');
    expect(keysOf(r)).toEqual([[1, [['North', 2]]]]);
    // No OData function tells the day of the week: the rows come, and memory groups them.
    service.calls.length = 0;
    const weekdays = await adapter.loadPivotMembers({ levels: [{ field: 'day', interval: 'dayOfWeek' }], slices: [{ parent: [] }] });
    expect([service.calls.map((c) => c.query.$apply), weekdays.slices[0].total]).toEqual([[undefined], 3]);
  });
});

describe('ODataAdapter pivot member places', () => {
  type Sale = { id: number; region: string | null; city: string; amount: number | null };
  const sales$ = (service: ReturnType<typeof fakeService>) => new ODataAdapter<Sale, number>({ url: 'https://host/odata/Sales', key: 'id', locale: 'en-US', fetch: service.fetch, aggregation: true });
  const serviceOf = (answers: Record<string, unknown>) =>
    fakeService((call) => {
      const key = [call.query.$apply, call.query.$orderby, call.query.$skip, call.query.$top].filter((part) => part !== undefined).join(' | ');
      return json(answers[key] ?? { '@odata.count': 0, value: [] });
    });
  const sum = 'aggregate($count as _n,amount with sum as _m0)';

  it('counts the members before each one in value order, the empty member last', async () => {
    const listed = "filter(region eq 'North')/filter(city ne null)/groupby((region,city),aggregate($count as _n))";
    const service = serviceOf({
      [`${listed} | city asc | 0`]: { '@odata.count': 2, value: [] },
      [`${listed} | 0`]: { '@odata.count': 2, value: [] },
      [`${listed}/filter(city lt 'Oslo') | 0`]: { '@odata.count': 1, value: [] },
      [`${listed}/filter(city eq 'Oslo') | 0`]: { '@odata.count': 1, value: [] },
      [`${listed}/filter(city lt 'Lima') | 0`]: { '@odata.count': 1, value: [] },
      "filter(region eq 'North')/filter(city eq null)/aggregate($count as _n)": { value: [{ _n: 1 }] },
    });
    const r = await sales$(service).loadPivotMembers({ levels: [{ field: 'region' }, { field: 'city' }], slices: [{ parent: ['North'], take: 0 }], find: [['North', 'Oslo'], ['North', 'Lima'], ['North', null]] });
    expect([r.slices[0].total, r.found]).toEqual([3, [1, -1, 2]]);
  });

  it('places a member ordered by a measure: the groups before, then the members of its group before it, the empty member after its ties', async () => {
    const listed = `filter(region ne null)/groupby((region),${sum})`;
    const service = serviceOf({
      [`${listed}/filter(_m0 gt 0) | 0`]: { '@odata.count': 2, value: [] },
      [`filter(region eq null)/${sum}`]: { value: [{ _n: 1, _m0: 5 }] },
      [`${listed}/filter(region eq 'South')`]: { value: [{ region: 'South', _n: 1, _m0: 20 }] },
      [`${listed}/filter(_m0 gt 0)/filter(_m0 gt 20 or (_m0 eq 20 and region gt 'South')) | 0`]: { '@odata.count': 1, value: [] },
      [`${listed}/filter(_m0 gt 0)/filter(_m0 gt 5 or (_m0 eq 5)) | 0`]: { '@odata.count': 2, value: [] },
    });
    const r = await sales$(service).loadPivotMembers({
      levels: [{ field: 'region', dir: 'desc' }],
      slices: [{ parent: [], take: 0 }],
      measures: [{ type: 'sum', field: 'amount' }],
      sortBySummary: { measure: 0 },
      find: [['South'], [null], ['West']],
    });
    // North 40, South 20, the empty region 5: South after North, the empty region after both.
    expect([r.slices[0].total, r.found]).toEqual([3, [1, 2, -1]]);
  });

  it('finds no member nonEmpty leaves out', async () => {
    const avg = 'aggregate($count as _n,amount with average as _m0)';
    const listed = `filter(region eq 'North')/filter(city ne null)/groupby((region,city),${avg})/filter(_m0 ne null)`;
    const empty = `filter(region eq 'North')/filter(city eq null)/${avg}/filter(_m0 ne null)`;
    const service = serviceOf({
      [`${listed} | city asc | 0`]: { '@odata.count': 1, value: [] },
      [`${listed}/filter(city lt 'Oslo') | 0`]: { '@odata.count': 0, value: [] },
      [`${listed}/filter(city eq 'Oslo') | 0`]: { '@odata.count': 1, value: [] },
      [empty]: { value: [] },
    });
    const r = await sales$(service).loadPivotMembers({
      levels: [{ field: 'region' }, { field: 'city' }],
      slices: [{ parent: ['North'], take: 0 }],
      measures: [{ type: 'avg', field: 'amount' }],
      nonEmpty: true,
      find: [['North', 'Oslo'], ['North', 'Bergen'], ['North', null]],
    });
    // Bergen and the empty city have no amount: neither is among the members.
    expect([r.slices[0].total, r.found]).toEqual([1, [0, -1, -1]]);
    expect(service.calls.map((c) => c.query.$apply)).toContain(`${listed}/filter(city eq 'Bergen')`);
    expect(service.calls.map((c) => c.query.$apply).filter((apply) => apply === empty)).toHaveLength(2);
  });
});
