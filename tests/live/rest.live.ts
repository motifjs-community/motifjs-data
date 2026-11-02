import { beforeAll, describe, expect, it } from 'vitest';
import { data } from '../../src';
const { and, queryArray, RestAdapter, sortRows, where } = data;

// Both services answer writes without keeping them.

type Product = { id: number; title: string; price: number; category: string };
type Post = { id: number; userId: number; title: string; body: string };

describe('RestAdapter on DummyJSON', () => {
  const requests: string[] = [];
  const products = new RestAdapter<Product, number>({
    url: 'https://dummyjson.com/products',
    key: 'id',
    locale: 'en-US',
    retry: { retries: 2 },
    // The service sorts by one field and cannot filter by our expressions; filtering runs in memory.
    capabilities: { filter: false },
    loadQuery: (o) => ({ skip: o.skip, limit: o.take ?? 0, sortBy: o.sort?.[0]?.field, order: o.sort?.[0]?.dir, select: o.select?.join(',') }),
    readRows: (body) => {
      const b = body as { products: Product[]; total: number };
      return { rows: b.products, total: b.total };
    },
    beforeSend: (request) => {
      if (request.operation === 'insert') request.url += '/add';
      requests.push(`${request.method} ${request.url}?${request.query}`);
    },
  });
  let all: Product[];

  beforeAll(async () => {
    all = (await products.load()).rows;
  });

  it('pages, sorts and selects on the service', async () => {
    const page = await products.load({ sort: [{ field: 'price', dir: 'desc' }], skip: 3, take: 4, count: true, select: ['title', 'price'] });
    expect(page.total).toBe(all.length);
    expect(page.rows.map((r) => r.price)).toEqual(sortRows(all, [{ field: 'price', dir: 'desc' }]).slice(3, 7).map((r) => r.price));
    expect(Object.keys(page.rows[0]).sort()).toEqual(['id', 'price', 'title']);
    expect(requests.at(-1)).toBe('GET https://dummyjson.com/products?skip=3&limit=4&sortBy=price&order=desc&select=title%2Cprice');
  });

  it('filters in memory and pages the result', async () => {
    const filter = and(where('category', '=', 'SMARTPHONES'), where('price', '<', 500));
    const page = await products.load({ filter, sort: [{ field: 'price', dir: 'asc' }], take: 3, count: true });
    const expected = sortRows(queryArray(all, { filter }, { locale: 'en-US' }).rows, [{ field: 'price', dir: 'asc' }]);
    expect(page.total).toBe(expected.length);
    expect(page.rows.map((r) => r.id)).toEqual(expected.slice(0, 3).map((r) => r.id));
    expect(requests.at(-1)).toContain('limit=0');
  });

  it('finds, inserts, updates and removes', async () => {
    expect((await products.byKey(1))?.title).toBe(all.find((r) => r.id === 1)!.title);
    expect(await products.byKey(99999)).toBeUndefined();

    const saved = await products.insert({ title: 'Pen', price: 3 });
    expect(saved).toMatchObject({ title: 'Pen', price: 3, id: expect.any(Number) });
    expect(requests.at(-1)).toMatch(/^POST https:\/\/dummyjson.com\/products\/add/);

    expect(await products.update(1, { price: 9 })).toMatchObject({ id: 1, price: 9 });
    await expect(products.update(99999, { price: 9 })).rejects.toMatchObject({ code: 'MJD204', plainMessage: "Product with id '99999' not found" });
    await products.remove(1);
  });
});

describe('RestAdapter on JSONPlaceholder', () => {
  const posts = new RestAdapter<Post, number>({
    url: 'https://jsonplaceholder.typicode.com/posts',
    key: 'id',
    retry: { retries: 2 },
    capabilities: { filter: false },
    loadQuery: (o) => ({
      _start: o.skip,
      _limit: o.take,
      _sort: o.sort?.map((s) => s.field).join(','),
      _order: o.sort?.map((s) => s.dir).join(','),
    }),
    // The total of a page is in a header.
    readRows: (body, _options, response) => {
      const rows = body as Post[];
      return { rows, total: Number(response.headers.get('x-total-count') ?? rows.length) };
    },
  });

  it('pages and sorts, with the total from X-Total-Count', async () => {
    const page = await posts.load({ sort: [{ field: 'id', dir: 'desc' }], skip: 2, take: 3, count: true, params: { userId: 1 } });
    expect(page).toMatchObject({ total: 10, rows: [{ id: 8 }, { id: 7 }, { id: 6 }] });
  });

  it('finds, inserts, updates and removes at url and url/key', async () => {
    expect((await posts.byKey(1))?.userId).toBe(1);
    expect(await posts.byKey(99999)).toBeUndefined();
    expect(await posts.insert({ userId: 1, title: 'New', body: 'Text' })).toMatchObject({ id: 101, title: 'New' });
    expect(await posts.update(1, { title: 'Changed' })).toMatchObject({ id: 1, userId: 1, title: 'Changed' });
    await posts.remove(1);
  });
});
