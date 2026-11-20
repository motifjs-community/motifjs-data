import { Component, reactive } from '@motifx/core';
import { data } from '@motifx-community/data';
import { Follow } from '../follow';
import { PivotTable } from '../parts/pivot-table';
import { RequestLog } from '../parts/request-log';
import { makeOrders, type Order } from '../sample/orders';

type Person = { UserName: string; FirstName: string; LastName: string; Gender: string };

const PEOPLE = `https://services.odata.org/TripPinRESTierService/(S(motifjspivot${Math.random().toString(36).slice(2, 10)}))/People`;

const MEASURES: { title: string; measure: data.PivotMeasure<Order> }[] = [
  { title: 'Sum of amount', measure: { type: 'sum', field: 'amount' } },
  { title: 'Average amount', measure: { type: 'avg', field: 'amount' } },
  { title: 'Orders', measure: { type: 'count' } },
  { title: 'Customers', measure: { type: 'countDistinct', field: 'customer' } },
];

const number = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : '–');
const month = new Intl.DateTimeFormat('en-US', { month: 'short' });

/** `loadPivot` over 100,000 orders in memory, and over TripPin's people on the service with `$apply`. */
export class PivotSection extends Component<HTMLDivElement> {
  private readonly orders = new data.ArrayAdapter<Order, number>({ data: makeOrders(100_000), key: 'id', locale: 'tr', fields: { date: 'date' } });
  private readonly people = new data.ODataAdapter<Person, string>({ url: PEOPLE, key: 'UserName', locale: 'en-US', aggregation: true, retry: { retries: 2 } });
  private readonly batched = new data.ODataAdapter<Person, string>({ url: PEOPLE, key: 'UserName', locale: 'en-US', aggregation: { batch: true }, retry: { retries: 2 } });
  private readonly follow = new Follow();
  private readonly state = reactive({ measure: 0, ms: 0, over500: false, batch: false, remote: 'Loading…' });
  private memory: data.PivotLoadResult | null = null;
  private remote: data.PivotLoadResult | null = null;
  private openRows: unknown[][] = [['İstanbul']];
  private openColumns: unknown[][] = [];
  private openPeople: unknown[][] = [['Osborn']];
  private everyone: Promise<Person[]> | null = null;
  private memoryRun = 0;
  private remoteRun = 0;

  override onConfigured() {
    this.class.add('demo-section');
  }

  override onConfig() {
    this.motif.setDisposable(() => {
      this.orders.dispose();
      this.people.dispose();
      this.batched.dispose();
    });
  }

  override onBuilt() {
    void this.loadMemory();
    void this.loadRemote();
  }

  private async loadMemory() {
    const run = ++this.memoryRun;
    const started = performance.now();
    const result = await this.orders.loadPivot({
      filter: this.state.over500 ? data.where('amount', '>', 500) : null,
      rows: [{ field: 'city' }, { field: 'customer' }],
      columns: [
        { field: 'date', interval: 'quarter' },
        { field: 'date', interval: 'month' },
      ],
      measures: MEASURES.map((m) => m.measure),
      expandedRows: this.openRows,
      expandedColumns: this.openColumns,
    });
    if (run !== this.memoryRun) return;
    this.state.ms = Math.round(performance.now() - started);
    this.memory = result;
    this.follow.changed();
  }

  private async loadRemote() {
    const run = ++this.remoteRun;
    const options: data.PivotLoadOptions<Person> = {
      rows: [{ field: 'LastName' }, { field: 'FirstName' }],
      columns: [{ field: 'Gender' }],
      measures: [{ type: 'count' }],
      expandedRows: this.openPeople,
    };
    this.state.remote = 'Loading…';
    try {
      const result = await (this.state.batch ? this.batched : this.people).loadPivot(options);
      if (run !== this.remoteRun) return;
      this.remote = result;
      this.follow.changed();
      this.state.remote = 'Comparing with the memory engine…';
      // Every person once, pivoted in the browser with the same options: the service must give the same table.
      this.everyone ??= this.people.load().then((r) => r.rows);
      const memory = data.queryPivot(await this.everyone, options, { locale: 'en-US' });
      if (run !== this.remoteRun) return;
      this.state.remote = this.shape(result) === this.shape(memory) ? 'Same table as the memory engine over every person.' : 'Differs from the memory engine.';
    } catch (error) {
      if (run !== this.remoteRun) return;
      this.state.remote = data.DataError.from(error, 'load').plainMessage;
    }
  }

  /** The visible rows with their counts and the values of every column, as text to compare (averages to 6 places). */
  private shape(result: data.PivotLoadResult): string {
    const rows = [result.rows, ...(result.rows.children ?? []).flatMap((m) => [m, ...(m.children ?? [])])];
    const columns = [result.columns, ...(result.columns.children ?? [])];
    const round = (v: unknown) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
    return JSON.stringify(rows.map((r) => [r.path, r.count, columns.map((c) => result.values(r, c)?.map(round) ?? null)]));
  }

  /** The open paths with `member` opened, or closed together with what is open under it. */
  private toggled(open: unknown[][], member: data.PivotMember): unknown[][] {
    if (!member.children) return [...open, [...member.path]];
    const key = JSON.stringify(member.path);
    return open.filter((p) => JSON.stringify(p.slice(0, member.path.length)) !== key);
  }

  override view() {
    const follow = this.follow;
    return (
      <div class="demo-split">
        <div class="demo-main">
          <p class="demo-lead">
            <code>loadPivot</code> groups the rows by row levels and column levels at once and gives both member trees with a
            value for every crossing. Each total is worked out from its own rows, so an average of a total is the average of
            its rows. Only open members bring their children; opening one loads the pivot again.
          </p>
          <h2 class="demo-subhead">In memory</h2>
          <div class="demo-tools">
            <div class="demo-group" role="group" aria-label="Measure">
              {MEASURES.map((m, i) => (
                <button key={m.title} type="button" class="demo-chip" aria-pressed={() => this.state.measure === i} onclick={() => (this.state.measure = i)}>
                  {m.title}
                </button>
              ))}
            </div>
            <button
              type="button"
              class="demo-chip"
              aria-pressed={() => this.state.over500}
              onclick={() => {
                this.state.over500 = !this.state.over500;
                void this.loadMemory();
              }}
            >
              Amount over 500
            </button>
          </div>
          <p class="demo-status" role="status">
            {() => (this.state.ms ? `ArrayAdapter · 100,000 orders · city → customer by quarter → month · ${this.state.ms} ms` : 'Loading…')}
          </p>
          <PivotTable
            result={() => follow.read(() => this.memory)}
            rowLevels={2}
            columnLevels={2}
            measure={() => this.state.measure}
            corner="City · customer"
            keyText={(axis, m) => (axis === 'row' ? String(m.key ?? '(empty)') : m.path.length === 1 ? `Q${String(m.key)}` : month.format(new Date(2024, Number(m.key) - 1, 1)))}
            valueText={number}
            onRow={(m) => {
              this.openRows = this.toggled(this.openRows, m);
              void this.loadMemory();
            }}
            onColumn={(m) => {
              this.openColumns = this.toggled(this.openColumns, m);
              void this.loadMemory();
            }}
          />
          <h2 class="demo-subhead">On the service</h2>
          <p class="demo-lead">
            TripPin's 20 people counted by last name, first name and gender with <code>$apply</code> on the service: one{' '}
            <code>groupby</code> per pair of levels, the totals included; <code>aggregation: {'{ batch: true }'}</code> sends
            them in one <code>$batch</code>. Date parts and ranges would need <code>compute</code>, which TripPin answers
            with 500, so a pivot that asks for them is grouped in memory instead.
          </p>
          <div class="demo-tools">
            <button
              type="button"
              class="demo-chip"
              aria-pressed={() => this.state.batch}
              onclick={() => {
                this.state.batch = !this.state.batch;
                void this.loadRemote();
              }}
            >
              One $batch
            </button>
          </div>
          <p class="demo-status" role="status">
            {() => this.state.remote}
          </p>
          <PivotTable
            result={() => follow.read(() => this.remote)}
            rowLevels={2}
            columnLevels={1}
            measure={() => 0}
            corner="Last name · first name"
            keyText={(_, m) => String(m.key ?? '(empty)')}
            valueText={number}
            onRow={(m) => {
              this.openPeople = this.toggled(this.openPeople, m);
              void this.loadRemote();
            }}
            onColumn={() => {}}
          />
        </div>
        <RequestLog adapters={[this.people, this.batched]} />
      </div>
    );
  }
}
