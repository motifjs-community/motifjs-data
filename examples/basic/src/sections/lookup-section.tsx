import { Component, reactive } from '@motifx/core';
import { data } from '@motifx-community/data';
import { Follow } from '../follow';
import { Pager } from '../parts/pager';
import { RequestLog } from '../parts/request-log';
import { SourceStatus } from '../parts/source-status';
import { northwindCustomers, type NorthwindCustomer } from '../sample/northwind';

/**
 * What a combo box needs from the data layer: a page of matches for the typed text, and the row of
 * the chosen value even when it is on no loaded page (`byKey`).
 */
export class LookupSection extends Component<HTMLDivElement> {
  private readonly adapter = northwindCustomers();
  private readonly source = new data.DataSource<NorthwindCustomer, string>({
    adapter: this.adapter,
    pageSize: 8,
    sort: [{ field: 'CompanyName', dir: 'asc' }],
    searchFields: ['CompanyName', 'ContactName', 'City'],
    select: ['CustomerID', 'CompanyName', 'ContactName', 'City', 'Country'],
  });
  private readonly follow = new Follow();
  private readonly state = reactive({ value: 'WOLZA', text: '', how: '' });

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
    void this.source.load().then(() => this.choose(this.state.value));
  }

  /** Shows the chosen value's text: from a loaded page when it is there, else one request. */
  private async choose(key: string) {
    this.state.value = key;
    const loaded = this.source.rowByKey(key);
    const row = loaded ?? (await this.source.byKey(key));
    this.state.text = row ? `${row.CompanyName} (${row.CustomerID})` : key;
    this.state.how = loaded ? 'found among the loaded rows, no request' : 'not on a loaded page: one request through byKey';
  }

  override view() {
    const source = this.source as unknown as data.DataSource<never, never>;
    const follow = this.follow;
    return (
      <div class="demo-split">
        <div class="demo-main">
          <p class="demo-lead">
            Type to search company, contact or city. The value starts as <code>WOLZA</code>, which is on no loaded page: its text
            comes from <code>byKey</code>. Choose a row from the list and it comes from the loaded rows.
          </p>
          <label class="demo-field">
            <span>Customer</span>
            <output class="demo-value">{() => this.state.text}</output>
            <small class="demo-muted">{() => this.state.how}</small>
          </label>
          <input type="search" class="demo-input" placeholder="Type to search" oninput={(e) => void this.source.search((e.target as HTMLInputElement).value)} />
          <SourceStatus source={source} follow={follow} />
          <ul class="demo-options" role="listbox" aria-label="Customers">
            {() =>
              follow.read(() => this.source.rows).map((c) => (
                <li key={c.CustomerID} role="option" aria-selected={() => this.state.value === c.CustomerID} onclick={() => void this.choose(c.CustomerID)}>
                  <b>{c.CompanyName}</b>
                  <span class="demo-muted">{`${c.ContactName} · ${c.City}, ${c.Country}`}</span>
                </li>
              ))
            }
          </ul>
          <Pager source={source} follow={follow} />
        </div>
        <RequestLog adapters={[this.adapter]} />
      </div>
    );
  }
}
