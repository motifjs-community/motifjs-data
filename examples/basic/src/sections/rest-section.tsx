import { Component } from '@motifx/core';
import { data } from '@motifx-community/data';
import { Follow } from '../follow';
import { GroupCards } from '../parts/group-cards';
import { Pager } from '../parts/pager';
import { RequestLog } from '../parts/request-log';
import { SortHeader } from '../parts/sort-header';
import { SourceStatus } from '../parts/source-status';
import { money } from '../sample/northwind';

type Product = { id: number; title: string; brand?: string; category: string; price: number; stock: number; rating: number };

/** DummyJSON through `RestAdapter`: its own query names and answer shape, mapped with two options. */
export class RestSection extends Component<HTMLDivElement> {
  private readonly adapter = new data.RestAdapter<Product, number>({
    url: 'https://dummyjson.com/products',
    key: 'id',
    locale: 'en-US',
    timeoutMs: 20_000,
    retry: { retries: 2 },
    // The service sorts by one field and pages, but cannot filter by our expressions.
    capabilities: { filter: false },
    loadQuery: (o) => ({ skip: o.skip, limit: o.take ?? 0, sortBy: o.sort?.[0]?.field, order: o.sort?.[0]?.dir, select: o.select?.join(',') }),
    readRows: (body) => {
      const b = body as { products: Product[]; total: number };
      return { rows: b.products, total: b.total };
    },
  });
  private readonly source = new data.DataSource<Product, number>({
    adapter: this.adapter,
    pageSize: 10,
    sort: [{ field: 'id', dir: 'asc' }],
    searchFields: ['title', 'brand', 'category'],
    select: ['id', 'title', 'brand', 'category', 'price', 'stock', 'rating'],
    groupSummary: [{ type: 'avg', field: 'price' }],
    summary: [{ type: 'count' }, { type: 'avg', field: 'price' }, { type: 'sum', field: 'stock' }],
  });
  private readonly follow = new Follow();

  override onConfigured() {
    this.class.add('demo-section');
  }

  override onConfig() {
    this.motif.register(this.source.onChanged(this.follow.changed));
    this.motif.setDisposable(() => {
      this.source.dispose();
      this.adapter.dispose();
    });
  }

  override onBuilt() {
    void this.source.load();
  }

  private grouped(): boolean {
    return this.follow.read(() => this.source.group.length > 0);
  }

  override view() {
    const source = this.source as unknown as data.DataSource<never, never>;
    const follow = this.follow;
    return (
      <div class="demo-split">
        <div class="demo-main">
          <p class="demo-lead">
            <code>loadQuery</code> writes DummyJSON's <code>skip</code>, <code>limit</code>, <code>sortBy</code>, <code>select</code>;
            <code> readRows</code> reads <code>products</code> and <code>total</code>. The service cannot filter, so a search loads the
            rows once (<code>limit=0</code>) and filters, sorts and pages them in memory.
          </p>
          <div class="demo-tools">
            <input type="search" class="demo-input" placeholder="Search title, brand or category" oninput={(e) => void this.source.search((e.target as HTMLInputElement).value)} />
            <button type="button" class="demo-chip" aria-pressed={() => this.grouped()} onclick={() => void this.source.setGroup(this.grouped() ? [] : [{ field: 'category' }])}>
              Group by category
            </button>
          </div>
          <SourceStatus source={source} follow={follow} />
          <table class="demo-table" x-wait={() => this.grouped()}>
            <thead>
              <tr>
                <SortHeader source={source} follow={follow} field="title" title="Product" />
                <SortHeader source={source} follow={follow} field="brand" title="Brand" />
                <SortHeader source={source} follow={follow} field="category" title="Category" />
                <SortHeader source={source} follow={follow} field="price" title="Price" numeric />
                <SortHeader source={source} follow={follow} field="stock" title="Stock" numeric />
                <SortHeader source={source} follow={follow} field="rating" title="Rating" numeric />
              </tr>
            </thead>
            <tbody>
              {() =>
                follow.read(() => this.source.rows).map((p) => (
                  <tr key={p.id}>
                    <td>{p.title}</td>
                    <td>{p.brand ?? '–'}</td>
                    <td>{p.category}</td>
                    <td class="is-number">{money(p.price)}</td>
                    <td class="is-number">{String(p.stock)}</td>
                    <td class="is-number">{String(p.rating)}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
          <div x-wait={() => !this.grouped()}>
            <GroupCards<Product>
              groups={() => follow.read(() => this.source.groups)}
              summary={(g) => `average price ${money(g.summary?.[0])}`}
              row={(p) => `${p.title} · ${money(p.price)}`}
              rowKey={(p) => p.id}
            />
          </div>
          <Pager source={source} follow={follow} />
          <p class="demo-totals">
            {() =>
              follow.read(() => {
                const [count, price, stock] = this.source.summary;
                return count === undefined ? 'Totals: loading…' : `Totals: ${String(count)} products · average price ${money(price)} · ${String(stock)} in stock`;
              })
            }
          </p>
        </div>
        <RequestLog adapters={[this.adapter]} />
      </div>
    );
  }
}
