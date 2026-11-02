import { Component, reactive } from '@motifx/core';
import { data } from '@motifx-community/data';
import { Follow } from '../follow';
import { RequestLog } from '../parts/request-log';
import { SourceStatus } from '../parts/source-status';
import { day, money, northwindOrders, type NorthwindOrder } from '../sample/northwind';

const ROW = 32;
const SHOWN = 14;
const EXTRA = 6;

/** A list as tall as every row, with only the rows in view in the page and only their blocks loaded. */
export class VirtualSection extends Component<HTMLDivElement> {
  private readonly adapter = northwindOrders();
  private readonly source = new data.DataSource<NorthwindOrder, number>({
    adapter: this.adapter,
    loadMode: 'blocks',
    pageSize: 50,
    sort: [{ field: 'OrderID', dir: 'asc' }],
    select: ['OrderID', 'CustomerID', 'ShipCity', 'ShipCountry', 'OrderDate', 'Freight'],
  });
  private readonly follow = new Follow();
  private readonly state = reactive({ first: 0 });
  private scroller: HTMLElement | null = null;

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

  private scrolled(element: HTMLElement) {
    const first = Math.floor(element.scrollTop / ROW);
    this.state.first = first;
    this.source.ensure(first, first + SHOWN + EXTRA);
  }

  private jump(row: number) {
    const total = this.source.total ?? 0;
    const first = Math.max(0, Math.min(total - 1, Math.floor(row) - 1));
    this.source.ensure(first, first + SHOWN + EXTRA, true);
    if (this.scroller) this.scroller.scrollTop = first * ROW;
    this.state.first = first;
  }

  // Objects, so the list keeps a row while its index stays in view.
  private shownRows(): { index: number }[] {
    const total = this.follow.read(() => this.source.total ?? 0);
    const start = Math.max(0, this.state.first - EXTRA);
    const end = Math.min(total, this.state.first + SHOWN + EXTRA);
    return Array.from({ length: Math.max(0, end - start) }, (_, i) => ({ index: start + i }));
  }

  private rowText(index: number): string {
    return this.follow.read(() => {
      const o = this.source.rowAt(index);
      if (o) return `${index + 1}. #${o.OrderID} · ${o.ShipCity}, ${o.ShipCountry} · ${day(o.OrderDate)} · ${money(o.Freight)}`;
      return this.source.isFailed(index) ? `${index + 1}. failed to load` : `${index + 1}. loading…`;
    });
  }

  private loadedCount(): number {
    return this.follow.read(() => {
      let n = 0;
      this.source.forEachLoaded(() => n++);
      return n;
    });
  }

  override view() {
    const source = this.source as unknown as data.DataSource<never, never>;
    return (
      <div class="demo-split">
        <div class="demo-main">
          <p class="demo-lead">
            <code>loadMode: 'blocks'</code>: the list is as tall as all 830 orders; blocks of 50 load where the view is. Drag the scroll bar:
            nothing passed over is requested, a block left behind while loading is aborted.
          </p>
          <div class="demo-tools">
            <label class="demo-inline">
              Go to row
              <input type="number" class="demo-input demo-narrow" min="1" onchange={(e) => this.jump(Number((e.target as HTMLInputElement).value))} />
            </label>
            <span class="demo-muted">{() => `${this.loadedCount()} of ${this.follow.read(() => this.source.total ?? 0)} orders in memory`}</span>
          </div>
          <SourceStatus source={source} follow={this.follow} />
          <div
            class="demo-virtual"
            style={`block-size: ${SHOWN * ROW}px`}
            ref={(c: { element: unknown }) => (this.scroller = c.element as HTMLElement)}
            onscroll={(e) => this.scrolled(e.target as HTMLElement)}
          >
            <div class="demo-virtual-space" style={() => `block-size: ${this.follow.read(() => this.source.total ?? 0) * ROW}px`}>
              {() =>
                this.shownRows().map(({ index }) => (
                  <div key={index} class="demo-virtual-row" style={`inset-block-start: ${index * ROW}px; block-size: ${ROW}px`}>
                    {() => this.rowText(index)}
                  </div>
                ))
              }
            </div>
          </div>
        </div>
        <RequestLog adapters={[this.adapter]} />
      </div>
    );
  }
}
