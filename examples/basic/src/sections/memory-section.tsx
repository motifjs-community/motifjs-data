import { Component, reactive } from '@motifx/core';
import { data } from '@motifx-community/data';
import { Follow } from '../follow';
import { GroupCards } from '../parts/group-cards';
import { Pager } from '../parts/pager';
import { SortHeader } from '../parts/sort-header';
import { SourceStatus } from '../parts/source-status';
import { makeOrders, type Order } from '../sample/orders';

const number = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : '–');

/** 100,000 rows in an array: search, sort, pages, groups and totals, all through `ArrayAdapter`. */
export class MemorySection extends Component<HTMLDivElement> {
  private readonly source = new data.DataSource<Order, number>({
    adapter: new data.ArrayAdapter<Order, number>({ data: makeOrders(100_000), key: 'id', locale: 'tr', fields: { date: 'date' } }),
    pageSize: 12,
    sort: [{ field: 'customer', dir: 'asc' }],
    searchFields: ['customer', 'city'],
    groupSummary: [{ type: 'sum', field: 'amount' }],
    summary: [{ type: 'sum', field: 'amount' }, { type: 'avg', field: 'amount' }, { type: 'max', field: 'date' }],
  });
  private readonly follow = new Follow();
  private readonly state = reactive({ ms: 0 });
  private started = 0;

  override onConfigured() {
    this.class.add('demo-section');
  }

  override onConfig() {
    this.motif.register(
      this.source.onChanged((e) => {
        if (e.reason === 'loading') this.started = performance.now();
        if (e.reason === 'loaded') this.state.ms = Math.round(performance.now() - this.started);
        this.follow.changed();
      }),
    );
    this.motif.setDisposable(() => this.source.dispose());
  }

  override onBuilt() {
    void this.source.load();
  }

  private grouped(): boolean {
    return this.follow.read(() => this.source.group.length > 0);
  }

  private groupBy(field: string | null) {
    void this.source.setGroup(field ? [{ field }] : []);
  }

  override view() {
    const source = this.source as unknown as data.DataSource<never, never>;
    const follow = this.follow;
    return (
      <>
        <p class="demo-lead">
          <code>ArrayAdapter</code> runs filter, sort, groups and summaries in memory with the same rules a server translation uses: text
          without case in the locale (try <kbd>ış</kbd> or <kbd>İSTANBUL</kbd>), dates by day, empty values last.
        </p>
        <div class="demo-tools">
          <input type="search" class="demo-input" placeholder="Search customer or city" oninput={(e) => void this.source.search((e.target as HTMLInputElement).value)} />
          <div class="demo-group" role="group" aria-label="Group by">
            <button type="button" class="demo-chip" aria-pressed={() => !this.grouped()} onclick={() => this.groupBy(null)}>
              No groups
            </button>
            <button type="button" class="demo-chip" aria-pressed={() => follow.read(() => this.source.group[0]?.field === 'city')} onclick={() => this.groupBy('city')}>
              By city
            </button>
            <button type="button" class="demo-chip" aria-pressed={() => follow.read(() => this.source.group[0]?.field === 'customer')} onclick={() => this.groupBy('customer')}>
              By customer
            </button>
          </div>
        </div>
        <SourceStatus source={source} follow={follow} extra={() => `${this.state.ms} ms`} />
        <table class="demo-table" x-wait={() => this.grouped()}>
          <thead>
            <tr>
              <SortHeader source={source} follow={follow} field="id" title="#" numeric />
              <SortHeader source={source} follow={follow} field="customer" title="Customer" />
              <SortHeader source={source} follow={follow} field="city" title="City" />
              <SortHeader source={source} follow={follow} field="amount" title="Amount" numeric />
              <SortHeader source={source} follow={follow} field="date" title="Date" />
            </tr>
          </thead>
          <tbody>
            {() =>
              follow.read(() => this.source.rows).map((r) => (
                <tr key={r.id}>
                  <td class="is-number">{String(r.id)}</td>
                  <td>{r.customer}</td>
                  <td>{r.city}</td>
                  <td class="is-number">{number(r.amount)}</td>
                  <td>{r.date}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
        <div x-wait={() => !this.grouped()}>
          <GroupCards<Order>
            groups={() => follow.read(() => this.source.groups)}
            summary={(g) => `sum ${number(g.summary?.[0])}`}
            row={(r) => `#${r.id} · ${r.customer} · ${r.city} · ${number(r.amount)}`}
            rowKey={(r) => r.id}
          />
        </div>
        <Pager source={source} follow={follow} />
        <p class="demo-totals">
          {() =>
            follow.read(() => {
              const [sum, avg, last] = this.source.summary;
              return `Totals over every matching row: sum ${number(sum)} · average ${number(avg)} · last date ${String(last ?? '–')}`;
            })
          }
        </p>
      </>
    );
  }
}
