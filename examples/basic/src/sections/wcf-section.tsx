import { Component, reactive } from '@motifx/core';
import { data } from '@motifx-community/data';
import { Follow } from '../follow';
import { EditCell } from '../parts/edit-cell';
import { SourceStatus } from '../parts/source-status';

type WcfOrder = { Id: number; Version: number; Customer: string; Amount: number; OrderDate: string; Shipped: boolean; Note: string | null; Tags: string[] };

const SERVICE = 'http://localhost:5190';

/** Indents XML one element per line, for reading an envelope. */
function indentXml(xml: string): string {
  let depth = 0;
  return xml
    .replace(/></g, '>\n<')
    .split('\n')
    .map((line) => {
      if (line.startsWith('</')) depth--;
      const out = '  '.repeat(Math.max(0, depth)) + line;
      if (/^<[^!?/][^>]*[^/]>$/.test(line) && !line.includes('</')) depth++;
      return out;
    })
    .join('\n');
}

/** The WCF service of the live tests (`npm run wcf`), through `SoapAdapter` and `ChangeTracker`. */
export class WcfSection extends Component<HTMLDivElement> {
  private readonly follow = new Follow();
  private readonly state = reactive({ available: null as boolean | null, envelope: '', message: '' });
  private adapter: data.SoapAdapter<WcfOrder, number> | null = null;
  private source: data.DataSource<WcfOrder, number> | null = null;
  private tracker: data.ChangeTracker<WcfOrder, number> | null = null;

  override onConfigured() {
    this.class.add('demo-section');
  }

  override onConfig() {
    this.motif.setDisposable(() => {
      this.tracker?.dispose();
      this.source?.dispose();
      this.adapter?.dispose();
    });
  }

  override onBuilt() {
    void this.connect();
  }

  private async connect() {
    this.state.available = null;
    try {
      this.state.available = (await fetch(`${SERVICE}/OrderService.svc?wsdl`)).ok;
    } catch {
      this.state.available = false;
    }
    if (this.state.available && !this.source) this.start();
  }

  private start() {
    const adapter = new data.SoapAdapter<WcfOrder, number>({
      url: `${SERVICE}/OrderService.svc`,
      key: 'Id',
      locale: 'tr',
      contract: 'IOrderService',
      dataNamespace: 'http://schemas.datacontract.org/2004/07/Shop',
      firstFields: ['Id', 'Version'],
      lists: { Tags: 'string', Lines: 'OrderLine' },
      fields: { Id: 'number', Version: 'number', Amount: 'number', Shipped: 'boolean', OrderDate: 'datetime' },
      readFault: (fault, operation) => {
        const detail = (fault.detail as { OrderFault?: { Kind: string; Field: string | null } } | undefined)?.OrderFault;
        if (detail?.Kind === 'Conflict') return data.DataError.create('MJD205', { operation }, fault.message);
        if (detail?.Kind === 'Invalid' && detail.Field) return data.DataError.create('MJD202', { operation, fields: { [detail.Field]: fault.message } }, fault.message);
      },
      operations: {
        load: { name: 'GetAllOrders' },
        byKey: { name: 'GetOrder', args: (id) => ({ id }) },
        update: { name: 'UpdateOrder', args: (id, changes, original) => ({ order: { ...original, ...changes, Id: id } }) },
      },
    });
    this.adapter = adapter;
    this.source = new data.DataSource<WcfOrder, number>({ adapter, loadMode: 'all', sort: [{ field: 'Id', dir: 'asc' }] });
    this.tracker = new data.ChangeTracker<WcfOrder, number>({ source: this.source, saveMode: 'wait' });
    this.motif.register(adapter.onRequesting((request) => (this.state.envelope = indentXml(String(request.body ?? '')))));
    this.motif.register(this.source.onChanged(this.follow.changed));
    this.motif.register(this.tracker.onChanged(this.follow.changed));
    this.follow.changed();
    void this.source.load();
  }

  private async leave(row: WcfOrder) {
    const saved = await this.tracker!.commit(row);
    this.state.message = saved ? `Order ${row.Id} saved; its version is now ${row.Version}.` : this.tracker!.messageOf(row);
  }

  private rows(): WcfOrder[] {
    return this.follow.read(() => [...(this.source?.rows ?? [])]);
  }

  override view() {
    const tracker = () => this.tracker as unknown as data.ChangeTracker<WcfOrder, never>;
    const leave = (row: WcfOrder) => void this.leave(row);
    return (
      <>
        <p class="demo-lead">
          A CoreWCF service with <code>basicHttpBinding</code>. Objects are written the way <code>DataContractSerializer</code> reads them:
          fields in the data namespace, the base class fields (<code>Id</code>, <code>Version</code>) first, the rest in alphabetical order.
          An update carries the version it read; the service refuses an old one with a fault.
        </p>
        <div class="demo-notice" x-wait={() => this.state.available !== false}>
          <p>
            The service is not running. Start it in the package folder with <code>npm run wcf</code> (needs the .NET 9 SDK); it listens on
            <code> {SERVICE}</code>.
          </p>
          <button type="button" class="demo-chip" onclick={() => void this.connect()}>
            Try again
          </button>
        </div>
        <div class="demo-split" x-wait={() => !this.state.available}>
          <div class="demo-main">
            <p class="demo-message" role="alert" x-wait={() => !this.state.message}>
              {() => this.state.message}
            </p>
            <div x-wait={() => !this.source}>
              {() => (this.source ? <SourceStatus source={this.source as unknown as data.DataSource<never, never>} follow={this.follow} /> : null)}
            </div>
            <table class="demo-table demo-edit">
              <thead>
                <tr>
                  <th class="is-number">Id</th>
                  <th>Customer</th>
                  <th class="is-number">Amount</th>
                  <th class="is-number">Version</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {() =>
                  this.rows().map((row) => (
                    <tr key={row.Id}>
                      <td class="is-number">{String(row.Id)}</td>
                      <td>
                        <EditCell<WcfOrder> tracker={tracker} row={row} field="Customer" follow={this.follow} leave={leave} />
                      </td>
                      <td class="is-number">
                        <EditCell<WcfOrder> tracker={tracker} row={row} field="Amount" type="number" follow={this.follow} leave={leave} />
                      </td>
                      <td class="is-number">{() => this.follow.read(() => String(row.Version))}</td>
                      <td>
                        <span class="demo-badge">{() => this.follow.read(() => this.tracker?.statusOf(row) || 'saved')}</span>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
          <div class="demo-log">
            <h2>Last envelope</h2>
            <pre class="demo-xml">{() => this.state.envelope || 'Nothing sent yet.'}</pre>
          </div>
        </div>
      </>
    );
  }
}
