import { Component } from '@motifx/core';
import { data } from '@motifx-community/data';
import { Follow } from '../follow';
import { GroupCards } from '../parts/group-cards';
import { Pager } from '../parts/pager';
import { RequestLog } from '../parts/request-log';
import { SortHeader } from '../parts/sort-header';
import { SourceStatus } from '../parts/source-status';
import { day, money, northwindOrders, type NorthwindOrder } from '../sample/northwind';

const COUNTRIES = ['Germany', 'USA', 'Brazil', 'France'];

/** Northwind's orders through `ODataAdapter`: the query runs on the service, the requests are listed on the right. */
export class ODataSection extends Component<HTMLDivElement> {
  private readonly adapter = northwindOrders();
  private readonly source = new data.DataSource<NorthwindOrder, number>({
    adapter: this.adapter,
    pageSize: 10,
    sort: [{ field: 'OrderID', dir: 'desc' }],
    searchFields: ['ShipName', 'ShipCity', 'CustomerID'],
    expand: ['Customer'],
    groupSummary: [{ type: 'sum', field: 'Freight' }],
    summary: [{ type: 'count' }, { type: 'sum', field: 'Freight' }, { type: 'max', field: 'OrderDate' }],
  });
  private readonly follow = new Follow();
  private country: string | null = null;

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

  private showCountry(country: string | null) {
    this.country = country;
    void this.source.setFilter(country ? data.where('ShipCountry', '=', country) : null);
  }

  // Grouped, `rows` holds every row of the page's groups; the cards show a few of each instead.
  private tableRows() {
    return this.grouped() ? [] : this.follow.read(() => this.source.rows);
  }

  private grouped(): boolean {
    return this.follow.read(() => this.source.group.length > 0);
  }

  override view() {
    const source = this.source as unknown as data.DataSource<never, never>;
    const follow = this.follow;
    const pressed = (country: string | null) => () => follow.read(() => this.country === country);
    return (
      <div class="demo-split">
        <div class="demo-main">
          <p class="demo-lead">
            Filter, search and <code>$expand</code> run on the service. The search is <code>contains(tolower(…))</code> over
            three fields; typing aborts the request before. Northwind has no <code>$apply</code>, so the totals need every
            matching order: they load once per filter (200 per answer) and are kept. The first page loads apart so it shows
            sooner; after that, pages, sorting and groups come from the kept orders without a request.
          </p>
          <div class="demo-tools">
            <input type="search" class="demo-input" placeholder="Search ship name, city or customer" oninput={(e) => void this.source.search((e.target as HTMLInputElement).value)} />
            <div class="demo-group" role="group" aria-label="Country">
              <button type="button" class="demo-chip" aria-pressed={pressed(null)} onclick={() => this.showCountry(null)}>
                All countries
              </button>
              {COUNTRIES.map((c) => (
                <button key={c} type="button" class="demo-chip" aria-pressed={pressed(c)} onclick={() => this.showCountry(c)}>
                  {c}
                </button>
              ))}
            </div>
            <button type="button" class="demo-chip" aria-pressed={() => this.grouped()} onclick={() => void this.source.setGroup(this.grouped() ? [] : [{ field: 'ShipCountry' }])}>
              Group by country
            </button>
          </div>
          <SourceStatus source={source} follow={follow} />
          <table class="demo-table" x-wait={() => this.grouped()}>
            <thead>
              <tr>
                <SortHeader source={source} follow={follow} field="OrderID" title="Order" numeric />
                <th>Customer</th>
                <SortHeader source={source} follow={follow} field="ShipCity" title="Ship city" />
                <SortHeader source={source} follow={follow} field="ShipCountry" title="Country" />
                <SortHeader source={source} follow={follow} field="OrderDate" title="Date" />
                <SortHeader source={source} follow={follow} field="Freight" title="Freight" numeric />
              </tr>
            </thead>
            <tbody>
              {() =>
                this.tableRows().map((o) => (
                  <tr key={o.OrderID}>
                    <td class="is-number">{String(o.OrderID)}</td>
                    <td>{o.Customer?.CompanyName ?? o.CustomerID}</td>
                    <td>{o.ShipCity}</td>
                    <td>{o.ShipCountry}</td>
                    <td>{day(o.OrderDate)}</td>
                    <td class="is-number">{money(o.Freight)}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
          <div x-wait={() => !this.grouped()}>
            <GroupCards<NorthwindOrder>
              groups={() => follow.read(() => this.source.groups)}
              summary={(g) => `freight ${money(g.summary?.[0])}`}
              row={(o) => `#${o.OrderID} · ${o.ShipCity} · ${money(o.Freight)}`}
              rowKey={(o) => o.OrderID}
            />
          </div>
          <Pager source={source} follow={follow} />
          <p class="demo-totals">
            {() =>
              follow.read(() => {
                const [count, freight, last] = this.source.summary;
                return count === undefined ? 'Totals: loading…' : `Totals: ${String(count)} orders · freight ${money(freight)} · last order ${day(last)}`;
              })
            }
          </p>
        </div>
        <RequestLog adapters={[this.adapter]} />
      </div>
    );
  }
}

