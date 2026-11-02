import { Component, reactive, type IDisposable } from '@motifx/core';
import { data } from '@motifx-community/data';
import { Follow } from '../follow';
import { EditCell } from '../parts/edit-cell';
import { RequestLog } from '../parts/request-log';
import { SourceStatus } from '../parts/source-status';

type Airline = { AirlineCode: string; Name: string; '@odata.etag'?: string };

// A private TripPin session: writes stay in it and are gone when it ends.
const SESSION = `https://services.odata.org/TripPinRESTierService/(S(motifjs${Math.random().toString(36).slice(2, 10)}))/`;

const MODES: { mode: data.SaveMode; title: string }[] = [
  { mode: 'wait', title: 'Save on leaving, wait' },
  { mode: 'background', title: 'Save on leaving, in the background' },
  { mode: 'batch', title: 'Save all at once' },
];

/** `ChangeTracker` over TripPin's airlines: edits, new rows, deletions, checks, three save modes and etags. */
export class EditingSection extends Component<HTMLDivElement> {
  private readonly adapter = new data.ODataAdapter<Airline, string>({ url: `${SESSION}Airlines`, key: 'AirlineCode', locale: 'en-US', timeoutMs: 20_000 });
  private readonly source = new data.DataSource<Airline, string>({ adapter: this.adapter, loadMode: 'all', sort: [{ field: 'AirlineCode', dir: 'asc' }] });
  private readonly follow = new Follow();
  private readonly state = reactive({ mode: 'wait' as data.SaveMode, message: '' });
  private tracker = this.createTracker('wait');
  private trackerEvents: IDisposable | null = null;

  override onConfigured() {
    this.class.add('demo-section');
  }

  override onConfig() {
    this.motif.register(this.source.onChanged(this.follow.changed));
    this.trackerEvents = this.tracker.onChanged(this.follow.changed);
    this.motif.setDisposable(() => {
      this.trackerEvents?.dispose();
      this.tracker.dispose();
      this.source.dispose();
      this.adapter.dispose();
    });
  }

  override onBuilt() {
    void this.source.load();
  }

  private createTracker(saveMode: data.SaveMode) {
    return new data.ChangeTracker<Airline, string>({
      source: this.source,
      saveMode,
      validateField: (field, value) => {
        const text = String(value ?? '').trim();
        if (field === 'Name' && text.length < 2) return 'At least two characters';
        if (field === 'AirlineCode' && !/^[A-Z0-9]{2}$/.test(text)) return 'Two capital letters or digits';
        return null;
      },
      validateRow: (row, { isNew }) => (isNew && !row.AirlineCode ? { AirlineCode: 'Required' } : !row.Name ? { Name: 'Required' } : null),
    });
  }

  private setMode(mode: data.SaveMode) {
    if (mode === this.state.mode) return;
    if (this.tracker.hasChanges) {
      this.state.message = 'Save or discard the changes before you switch modes.';
      return;
    }
    this.trackerEvents?.dispose();
    this.tracker.dispose();
    this.tracker = this.createTracker(mode);
    this.trackerEvents = this.tracker.onChanged(this.follow.changed);
    this.state.mode = mode;
    this.state.message = '';
    this.follow.changed();
  }

  private async leave(row: Airline) {
    const saved = await this.tracker.commit(row);
    this.state.message = saved ? '' : this.tracker.messageOf(row) || 'Check the marked values.';
  }

  private add() {
    this.tracker.add({}, 0);
  }

  private async remove(row: Airline) {
    const done = await this.tracker.remove(row);
    if (!done) this.state.message = this.tracker.messageOf(row);
  }

  private async saveAll() {
    const { saved, failed } = await this.tracker.saveChanges();
    this.state.message = `${saved} saved${failed ? `, ${failed} not saved` : ''}.`;
  }

  // Someone else changes the row: its etag on the service moves on, ours stays old.
  private async changeElsewhere(row: Airline) {
    const other = new data.ODataAdapter<Airline, string>({ url: `${SESSION}Airlines`, key: 'AirlineCode', locale: 'en-US' });
    try {
      await other.update(row.AirlineCode, { Name: `${row.Name} ★` }, { original: row });
      this.state.message = `${row.AirlineCode} was changed elsewhere. Edit it now: the save fails with MJD205; Reload gets the new version.`;
    } catch (error) {
      this.state.message = (error as data.DataError).plainMessage;
    } finally {
      other.dispose();
    }
  }

  private rows(): Airline[] {
    return this.follow.read(() => [...this.tracker.newRows, ...this.source.rows]);
  }

  private status(row: Airline): string {
    return this.follow.read(() => this.tracker.statusOf(row));
  }

  private isNew(row: Airline): boolean {
    return this.follow.read(() => this.tracker.newRows.includes(row));
  }

  override view() {
    const source = this.source as unknown as data.DataSource<never, never>;
    const tracker = () => this.tracker as unknown as data.ChangeTracker<Airline, never>;
    const leave = (row: Airline) => void this.leave(row);
    return (
      <div class="demo-split">
        <div class="demo-main">
          <p class="demo-lead">
            Edits are kept apart until they are saved. Each update sends only the changed field and <code>If-Match</code> with the
            row's etag; the service refuses an old one. <b>Change elsewhere</b> moves a row's etag on the service, so your next save of
            that row fails with <code>MJD205</code>.
          </p>
          <div class="demo-tools">
            <div class="demo-group" role="group" aria-label="Save mode">
              {MODES.map((m) => (
                <button key={m.mode} type="button" class="demo-chip" aria-pressed={() => this.state.mode === m.mode} onclick={() => this.setMode(m.mode)}>
                  {m.title}
                </button>
              ))}
            </div>
            <div class="demo-group">
              <button type="button" class="demo-chip" onclick={() => this.add()}>
                Add airline
              </button>
              <button type="button" class="demo-chip" disabled={() => this.follow.read(() => !this.tracker.hasChanges)} onclick={() => void this.saveAll()}>
                Save changes
              </button>
              <button type="button" class="demo-chip" disabled={() => this.follow.read(() => !this.tracker.hasChanges && !this.tracker.newRows.length)} onclick={() => this.tracker.discardChanges()}>
                Discard changes
              </button>
              <button type="button" class="demo-chip" onclick={() => void this.source.reload()}>
                Reload
              </button>
            </div>
          </div>
          <SourceStatus
            source={source}
            follow={this.follow}
            extra={() => this.follow.read(() => `${this.tracker.pendingCount} to save · ${this.tracker.savingCount} saving · ${this.tracker.failedCount} failed`)}
          />
          <p class="demo-message" role="alert" x-wait={() => !this.state.message}>
            {() => this.state.message}
          </p>
          <table class="demo-table demo-edit">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>State</th>
                <th>Etag</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {() =>
                this.rows().map((row) => (
                  <tr key={this.tracker.rowIdOf(row)} class={() => `is-${this.status(row) || 'saved'}`}>
                    <td>
                      <span x-wait={() => !this.isNew(row)}>
                        <EditCell<Airline> tracker={tracker} row={row} field="AirlineCode" follow={this.follow} leave={leave} />
                      </span>
                      <b x-wait={() => this.isNew(row)}>{row.AirlineCode}</b>
                    </td>
                    <td>
                      <EditCell<Airline> tracker={tracker} row={row} field="Name" follow={this.follow} leave={leave} />
                    </td>
                    <td>
                      <span class="demo-badge">{() => this.status(row) || 'saved'}</span>
                      <small class="is-error">{() => this.follow.read(() => (this.status(row) === 'failed' ? this.tracker.messageOf(row) : ''))}</small>
                    </td>
                    <td>
                      <code class="demo-muted">{() => this.follow.read(() => row['@odata.etag'] ?? '')}</code>
                    </td>
                    <td class="demo-actions">
                      <button type="button" class="demo-chip" x-wait={() => this.status(row) === 'removed'} onclick={() => void this.remove(row)}>
                        Delete
                      </button>
                      <button type="button" class="demo-chip" x-wait={() => this.status(row) !== 'removed'} onclick={() => this.tracker.restore(row)}>
                        Restore
                      </button>
                      <button type="button" class="demo-chip" x-wait={() => !['changed', 'invalid', 'failed', 'new'].includes(this.status(row))} onclick={() => this.tracker.discard(row)}>
                        Discard
                      </button>
                      <button type="button" class="demo-chip" x-wait={() => this.isNew(row)} onclick={() => void this.changeElsewhere(row)}>
                        Change elsewhere
                      </button>
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
        <RequestLog adapters={[this.adapter]} />
      </div>
    );
  }
}
