import { describe, expect, it, vi } from 'vitest';
import { data } from '../src';
const { queryArray, RestAdapter, where } = data;

type Order = { id: number; customer: string; amount: number };

interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
  signal: AbortSignal;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** An in-memory REST endpoint at /api/orders, reached through the adapter's `fetch` option. */
function fakeApi(rows: Order[]) {
  const calls: Call[] = [];
  let override: ((call: Call) => Response | Promise<Response> | undefined) | undefined;
  let nextId = 100;

  const fetch = async (input: string, init: RequestInit) => {
    const url = new URL(input, 'http://test');
    const call: Call = { method: init.method!, url, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : undefined, signal: init.signal! };
    calls.push(call);
    const custom = await override?.(call);
    if (custom) return custom;

    const q = url.searchParams;
    if (url.pathname === '/api/orders' && call.method === 'GET') {
      const sort = q.get('sort')?.split(',').map((s): data.SortItem => (s.startsWith('-') ? { field: s.slice(1), dir: 'desc' } : { field: s, dir: 'asc' }));
      const result = queryArray(rows, {
        filter: q.get('filter') ? JSON.parse(q.get('filter')!) : undefined,
        sort,
        skip: q.has('skip') ? Number(q.get('skip')) : undefined,
        take: q.has('take') ? Number(q.get('take')) : undefined,
        count: q.get('count') === 'true',
      });
      return json({ items: result.rows, total: result.total });
    }
    if (url.pathname === '/api/orders' && call.method === 'POST') {
      const row = { ...(call.body as Order), id: nextId++ };
      rows.push(row);
      return json(row, 201);
    }
    const id = Number(/^\/api\/orders\/(\d+)$/.exec(url.pathname)?.[1]);
    const row = rows.find((r) => r.id === id);
    if (!row) return json({ message: 'No such order' }, 404);
    if (call.method === 'GET') return json(row);
    if (call.method === 'PATCH') return json(Object.assign(row, call.body));
    rows.splice(rows.indexOf(row), 1);
    return new Response(null, { status: 204 });
  };

  return { fetch, calls, answer: (fn: typeof override) => (override = fn) };
}

const orders = (n: number): Order[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, customer: `c${i % 4}`, amount: i * 10 }));

function make(api: ReturnType<typeof fakeApi>, options: Partial<data.RestAdapterOptions<Order, number>> = {}) {
  return new RestAdapter<Order, number>({ url: '/api/orders', key: 'id', fetch: api.fetch, ...options });
}

describe('RestAdapter', () => {
  it('loads with query parameters and reads rows and total', async () => {
    const api = fakeApi(orders(20));
    const result = await make(api).load({ filter: where('customer', '=', 'c1'), sort: [{ field: 'amount', dir: 'desc' }], skip: 1, take: 2, count: true });
    const q = api.calls[0].url.searchParams;
    expect(Object.fromEntries(q)).toEqual({
      skip: '1',
      take: '2',
      count: 'true',
      sort: '-amount',
      filter: '{"field":"customer","op":"=","value":"c1"}',
    });
    expect(result).toEqual({ rows: [{ id: 14, customer: 'c1', amount: 130 }, { id: 10, customer: 'c1', amount: 90 }], total: 5 });
  });

  it('lets the app change every request and answer', async () => {
    const api = fakeApi(orders(3));
    let token = 'a';
    const adapter = make(api, {
      headers: () => ({ Authorization: `Bearer ${token}` }),
      credentials: 'include',
      beforeSend: async (request) => {
        request.query.set('tenant', '7');
        request.headers.set('X-Trace', request.operation);
        if (request.method === 'DELETE') request.cancel = true;
      },
      afterReceive: (response) => {
        if (response.request.operation === 'load') response.body = { items: (response.body as { items: Order[] }).items.slice(0, 1), total: 1 };
      },
    });
    const responded: data.HttpResponse[] = [];
    adapter.onResponded((r) => responded.push(r));
    adapter.onRequesting((r) => r.query.set('lang', 'tr'));

    token = 'b';
    const result = await adapter.load({ count: true });
    const call = api.calls[0];
    expect(call.headers.get('authorization')).toBe('Bearer b');
    expect(call.headers.get('x-trace')).toBe('load');
    expect(call.url.searchParams.get('tenant')).toBe('7');
    expect(call.url.searchParams.get('lang')).toBe('tr');
    expect(result).toEqual({ rows: [{ id: 1, customer: 'c0', amount: 0 }], total: 1 });
    expect(responded[0].status).toBe(200);

    await expect(adapter.remove(1)).rejects.toMatchObject({ code: 'MJD106' });
    expect(api.calls).toHaveLength(1);
  });

  it('finds, inserts, updates and removes', async () => {
    const rows = orders(3);
    const api = fakeApi(rows);
    const adapter = make(api);
    expect(await adapter.byKey(2)).toEqual({ id: 2, customer: 'c1', amount: 10 });
    expect(await adapter.byKey(99)).toBeUndefined();

    const saved = await adapter.insert({ customer: 'new', amount: 5 });
    expect(saved).toEqual({ id: 100, customer: 'new', amount: 5 });
    const post = api.calls.at(-1)!;
    expect([post.method, post.headers.get('content-type'), post.body]).toEqual(['POST', 'application/json', { customer: 'new', amount: 5 }]);

    await adapter.update(100, { amount: 6 });
    expect(api.calls.at(-1)).toMatchObject({ method: 'PATCH', body: { amount: 6 } });
    expect(api.calls.at(-1)!.url.pathname).toBe('/api/orders/100');
    await adapter.remove(100);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('writes a new id the server sends back onto the given object; a whole saved row is the server object', async () => {
    const api = fakeApi(orders(3));
    const adapter = make(api);
    const whole = { customer: 'new', amount: 5 } as Order;
    const saved = await adapter.insert(whole);
    expect(saved).not.toBe(whole);
    expect(saved).toEqual({ id: 100, customer: 'new', amount: 5 });

    api.answer(() => json({ id: 7 }, 201));
    const given = { customer: 'id only', amount: 1 } as Order;
    expect(await adapter.insert(given)).toBe(given);
    expect(given.id).toBe(7);

    api.answer(() => new Response(null, { status: 204 }));
    const changes = { amount: 2 };
    expect(await adapter.update(7, changes)).toBe(changes);
  });

  it('turns error answers into MJD codes', async () => {
    const api = fakeApi(orders(3));
    const adapter = make(api);
    const failWith = (status: number, body: unknown) => api.answer(() => json(body, status));

    failWith(500, { message: 'Database is down' });
    await expect(adapter.load()).rejects.toMatchObject({ code: 'MJD103', status: 500, plainMessage: 'Database is down' });
    failWith(400, { title: 'Invalid', errors: { amount: ['Must be positive', 'Too big'] } });
    await expect(adapter.update(1, { amount: -1 })).rejects.toMatchObject({ code: 'MJD202', fields: { amount: 'Must be positive Too big' } });
    failWith(409, { message: 'Order number taken' });
    await expect(adapter.insert({ customer: 'x' })).rejects.toMatchObject({ code: 'MJD203', plainMessage: 'Order number taken' });
    failWith(412, {});
    await expect(adapter.update(1, { amount: 1 })).rejects.toMatchObject({ code: 'MJD205', kind: 'conflict' });
    failWith(404, {});
    await expect(adapter.remove(1)).rejects.toMatchObject({ code: 'MJD204' });
    failWith(428, {});
    await expect(adapter.remove(1)).rejects.toMatchObject({ code: 'MJD305', kind: 'invalid' });
    api.answer(() => new Response('{oops', { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(adapter.load()).rejects.toMatchObject({ code: 'MJD104' });
    api.answer(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(adapter.load()).rejects.toMatchObject({ code: 'MJD101', kind: 'network' });
  });

  it('retries only transient failures', async () => {
    const api = fakeApi(orders(3));
    const adapter = make(api, { retry: { retries: 3, backoff: 'none' } });
    let failures = 2;
    api.answer(() => (failures-- > 0 ? json({}, 503) : undefined));
    await expect(adapter.load()).resolves.toMatchObject({ rows: expect.any(Array) });
    expect(api.calls).toHaveLength(3);

    api.calls.length = 0;
    api.answer(() => json({ message: 'Bad' }, 400));
    await expect(adapter.update(1, { amount: 1 })).rejects.toMatchObject({ code: 'MJD202' });
    expect(api.calls).toHaveLength(1);
  });

  it('times out and aborts the request; a cancelled caller stops it too', async () => {
    const api = fakeApi(orders(3));
    const hang = (call: Call) =>
      new Promise<Response>((_, reject) => call.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    api.answer(hang);
    await expect(make(api, { timeoutMs: 20 }).load()).rejects.toMatchObject({ code: 'MJD102', kind: 'timeout' });
    expect(api.calls[0].signal.aborted).toBe(true);

    const controller = new AbortController();
    const pending = make(api).load({ signal: controller.signal });
    await vi.waitFor(() => expect(api.calls).toHaveLength(2));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'MJD105' });
    expect(api.calls[1].signal.aborted).toBe(true);
  });

  it('filters in memory when the endpoint cannot', async () => {
    const api = fakeApi(orders(10));
    const result = await make(api, { capabilities: { filter: false } }).load({ filter: where('customer', '=', 'c2'), take: 2, count: true });
    expect(api.calls[0].url.searchParams.has('filter')).toBe(false);
    expect(api.calls[0].url.searchParams.has('take')).toBe(false);
    expect(result.total).toBe(2);
    expect(result.rows.map((r) => r.id)).toEqual([3, 7]);
  });

  it('sends a batch in one request', async () => {
    const api = fakeApi(orders(3));
    api.answer((call) => (call.url.pathname === '/api/batch' ? json([{ ok: true, id: 50 }, { ok: false, message: 'Locked' }]) : undefined));
    const adapter = make(api, {
      batch: {
        url: '/api/batch',
        write: (changes) => changes,
        read: (body) =>
          (body as { ok: boolean; id?: number; message?: string }[]).map((r) => (r.ok ? { ok: true, row: r.id ? { id: r.id } : undefined } : { ok: false, error: new Error(r.message) })),
      },
    });
    const outcomes = await adapter.save([
      { type: 'insert', data: { customer: 'x' } },
      { type: 'remove', key: 1 },
    ]);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].body).toEqual([{ type: 'insert', data: { customer: 'x' } }, { type: 'remove', key: 1 }]);
    expect(outcomes).toMatchObject([{ ok: true, key: 50 }, { ok: false, error: { plainMessage: 'Locked' } }]);
  });
});
