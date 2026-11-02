import { Component, reactive, type Event as MotifEvent } from '@motifx/core';
import type { data } from '@motifx-community/data';

interface Entry {
  id: number;
  method: string;
  target: string;
  status: number;
  ms: number;
  ifMatch: string;
}

let lastId = 0;

/** Requests of HTTP adapters, newest first: what was sent, the answer's status and how long it took. */
export class RequestLog extends Component<HTMLDivElement, { adapters: readonly { onResponded: MotifEvent<data.HttpResponse> }[] }> {
  private readonly state = reactive({ entries: [] as Entry[] });

  override onConfigured() {
    this.class.add('demo-log');
  }

  override onConfig() {
    for (const adapter of this.props.adapters) this.motif.register(adapter.onResponded((response) => this.add(response)));
  }

  private add(response: data.HttpResponse) {
    const { request } = response;
    const query = request.query.toString();
    const target = decodeURIComponent(`${request.url}${query ? `?${query}` : ''}`.replace(/\+/g, ' '));
    this.state.entries.unshift({
      id: ++lastId,
      method: request.method,
      target,
      status: response.status,
      ms: response.durationMs,
      ifMatch: request.headers.get('If-Match') ?? '',
    });
    if (this.state.entries.length > 40) this.state.entries.splice(40);
  }

  override view() {
    return (
      <>
        <h2>Requests</h2>
        <p class="demo-muted" x-wait={() => this.state.entries.length > 0}>
          Nothing sent yet.
        </p>
        <ol class="demo-requests">
          {() =>
            this.state.entries.map((e) => (
              <li key={e.id} class={e.status >= 400 ? 'is-error' : ''}>
                <span class="demo-request-head">
                  <b>{e.method}</b> <span>{String(e.status)}</span> <span class="demo-muted">{`${e.ms} ms`}</span>
                </span>
                <code>{e.target}</code>
                <small x-wait={() => !e.ifMatch}>{`If-Match: ${e.ifMatch}`}</small>
              </li>
            ))
          }
        </ol>
      </>
    );
  }
}
