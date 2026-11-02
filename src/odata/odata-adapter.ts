import type { BatchResult } from '../adapter/batch-result';
import type { ByKeyOptions } from '../adapter/by-key-options';
import type { Capabilities } from '../adapter/capabilities';
import type { Change } from '../adapter/change';
import type { OperationOptions } from '../adapter/operation-options';
import type { WriteOptions } from '../adapter/write-options';
import { DataError } from '../errors/data-error';
import { withValidValues } from '../errors/with-valid-values';
import { absoluteUrl } from '../http/absolute-url';
import { HttpAdapter } from '../http/http-adapter';
import type { HttpRequest } from '../http/http-request';
import type { HttpRequestInit } from '../http/http-request-init';
import { requestParams } from '../http/request-params';
import type { LoadOptions } from '../query/load-options';
import type { LoadResult } from '../query/load-result';
import { fieldTypeOf, isObject } from '../query/values';
import type { BatchRequestPart } from './batch-request-part';
import type { BatchResponsePart } from './batch-response-part';
import { readBatch, writeBatch } from './multipart-batch';
import type { ODataAdapterOptions } from './odata-adapter-options';
import { toODataFilter } from './odata-filter';
import { dayText, odataExpand, odataLiteral, odataPath } from './odata-syntax';

// Sent with writes only: a read with no custom header needs no CORS preflight.
const ODATA_HEADERS = { 'OData-Version': '4.0', 'OData-MaxVersion': '4.0' };
const AGGREGATE = { count: '', sum: 'sum', min: 'min', max: 'max', avg: 'average' } as const;

/**
 * An OData v4 entity set. Filtering, sorting, paging, counting, `$select` and `$expand` run on the
 * service, summaries too with `aggregation`; updates and removes send the `@odata.etag` of the
 * `original` row as `If-Match`.
 */
export class ODataAdapter<T = Record<string, unknown>, K = unknown> extends HttpAdapter<T, K> {
  private readonly odata: ODataAdapterOptions<T, K>;
  private readonly url: string;
  private readonly serviceRoot: string;

  constructor(options: ODataAdapterOptions<T, K>) {
    super(options);
    this.odata = options;
    this.url = options.url.replace(/\/+$/, '');
    this.serviceRoot = this.url.replace(/[^/]*$/, '');
    if (options.batch) this.saveBatch = (changes, operation) => this.sendBatch(changes, operation);
  }

  protected backendCapabilities(): Capabilities {
    const summary = !!this.odata.aggregation;
    return { filter: true, sort: true, paging: true, count: true, select: true, group: false, summary, insert: true, update: true, remove: true };
  }

  protected async loadRows(options: LoadOptions): Promise<LoadResult<T>> {
    const query = withValidValues('load', () => this.loadQuery(options));
    // Only summaries asked for: no rows to load.
    const rowsWanted = options.take !== 0 || options.count;
    const [result, summary] = await Promise.all([
      rowsWanted ? this.loadAllPages(query, options) : { rows: [] },
      options.summary?.length ? this.loadSummary(options) : undefined,
    ]);
    return summary ? { ...result, summary } : result;
  }

  private async loadAllPages(query: HttpRequestInit['query'], options: LoadOptions): Promise<LoadResult<T>> {
    const first = await this.loadPage(this.url, query, options.signal);
    const rows = [...first.rows];
    let next = first.nextLink;
    while (this.odata.followNextLink !== false && typeof next === 'string' && (options.take === undefined || rows.length < options.take)) {
      const page = await this.loadPage(this.linkUrl(next), undefined, options.signal);
      rows.push(...page.rows);
      next = page.nextLink;
    }
    if (options.take !== undefined && rows.length > options.take) rows.length = options.take;

    const readRow = this.odata.readRow;
    const result = readRow ? rows.map((row) => readRow(row as Record<string, unknown>)) : (rows as T[]);
    return first.total === undefined ? { rows: result } : { rows: result, total: Number(first.total) };
  }

  protected override async findRow(key: K, options: ByKeyOptions): Promise<T | undefined> {
    const url = withValidValues('byKey', () => this.itemUrl(key));
    const query = { $select: selectText(options.select), $expand: expandText(options.expand), ...requestParams(options) };
    try {
      const response = await this.send({ operation: 'byKey', method: 'GET', url, query, signal: options.signal });
      return isObject(response.body) ? this.readEntity(response.body) : undefined;
    } catch (error) {
      if (error instanceof DataError && error.code === 'MJD204') return undefined;
      throw error;
    }
  }

  protected override async insertRow(values: Partial<T>, options: OperationOptions): Promise<Partial<T> | void> {
    const response = await this.send({
      operation: 'insert',
      method: 'POST',
      url: this.url,
      query: requestParams(options),
      headers: this.writeHeaders(undefined, true),
      data: this.writeValues(values),
      signal: options.signal,
    });
    return this.readSaved(response.body, response.headers);
  }

  protected override async updateRow(key: K, changes: Partial<T>, options: WriteOptions<T>): Promise<Partial<T> | void> {
    const url = withValidValues('update', () => this.itemUrl(key));
    const response = await this.send({
      operation: 'update',
      method: this.odata.updateMethod ?? 'PATCH',
      url,
      query: requestParams(options),
      headers: this.writeHeaders(options.original, true),
      data: this.writeValues(changes),
      signal: options.signal,
    });
    return this.readSaved(response.body, response.headers);
  }

  protected override async removeRow(key: K, options: WriteOptions<T>): Promise<void> {
    const url = withValidValues('remove', () => this.itemUrl(key));
    await this.send({ operation: 'remove', method: 'DELETE', url, query: requestParams(options), headers: this.writeHeaders(options.original, false), signal: options.signal });
  }

  private async sendBatch(changes: readonly Change<T, K>[], options: OperationOptions): Promise<BatchResult<T>[]> {
    const settings = typeof this.odata.batch === 'object' ? this.odata.batch : {};
    const url = settings.url ?? `${this.serviceRoot}$batch`;
    const requests = withValidValues('save', () => changes.map((change) => this.batchRequest(change)));
    const boundary = `batch_${randomText()}`;
    const changeset = settings.allOrNothing ? `changeset_${randomText()}` : undefined;

    const response = await this.send({
      operation: 'save',
      method: 'POST',
      url,
      query: requestParams(options),
      headers: {
        ...ODATA_HEADERS,
        Accept: 'multipart/mixed',
        'Content-Type': `multipart/mixed; boundary=${boundary}`,
        // Without a change set every change is tried, as `save` promises.
        ...(changeset ? {} : { Prefer: 'odata.continue-on-error' }),
      },
      body: writeBatch(requests, boundary, changeset),
      signal: options.signal,
    });

    let answers: BatchResponsePart[];
    try {
      answers = readBatch(typeof response.body === 'string' ? response.body : '', response.headers.get('content-type') ?? '');
    } catch (error) {
      throw DataError.create('MJD104', { operation: 'save', details: response.body, cause: error }, (error as Error).message);
    }
    // A failed change set answers once for all of its changes.
    if (answers.length === 1 && changes.length > 1 && answers[0].status >= 400) answers = changes.map(() => answers[0]);
    const byId = new Map(answers.filter((a) => a.contentId).map((a) => [a.contentId, a]));

    const results: BatchResult<T>[] = [];
    for (let i = 0; i < changes.length; i++) {
      const answer = byId.get(String(i + 1)) ?? answers[i];
      if (!answer) break;
      results.push(this.batchResult(answer, changes[i], response.request));
    }
    return results;
  }

  private batchRequest(change: Change<T, K>): BatchRequestPart {
    const json = { 'Content-Type': 'application/json' };
    if (change.type === 'insert') {
      return { method: 'POST', url: absoluteUrl(this.url), headers: { ...json, ...this.writeHeaders(undefined, true) }, body: JSON.stringify(this.writeValues(change.data)) };
    }
    // Some services take only full addresses inside a batch.
    const url = absoluteUrl(this.itemUrl(change.key));
    if (change.type === 'update') {
      const headers = { ...json, ...this.writeHeaders(change.original, true) };
      return { method: this.odata.updateMethod ?? 'PATCH', url, headers, body: JSON.stringify(this.writeValues(change.data)) };
    }
    return { method: 'DELETE', url, headers: this.writeHeaders(change.original, false) };
  }

  private batchResult(answer: BatchResponsePart, change: Change<T, K>, request: HttpRequest): BatchResult<T> {
    if (answer.status >= 200 && answer.status < 300) return { ok: true, row: this.readSaved(answer.body, answer.headers) };
    const error = this.readError({
      request: { ...request, operation: change.type },
      status: answer.status,
      statusText: answer.statusText,
      headers: answer.headers,
      body: answer.body,
      durationMs: 0,
    });
    return { ok: false, error };
  }

  private loadQuery(o: LoadOptions): HttpRequestInit['query'] {
    const filter = this.filterText(o);
    return {
      $filter: filter === 'true' ? undefined : filter,
      $orderby: o.sort?.length ? o.sort.map((s) => `${odataPath(s.field)}${s.dir === 'desc' ? ' desc' : ''}`).join(',') : undefined,
      $skip: o.skip || undefined,
      $top: o.take,
      $count: o.count || undefined,
      $select: selectText(o.select),
      $expand: expandText(o.expand),
      ...requestParams(o),
    };
  }

  private filterText(o: LoadOptions): string {
    return o.filter ? toODataFilter(o.filter, { fields: this.fields, locale: this.locale, ignoreCase: this.odata.ignoreCase }) : 'true';
  }

  private async loadPage(url: string, query: HttpRequestInit['query'], signal: AbortSignal | undefined) {
    const response = await this.send({ operation: 'load', method: 'GET', url, query, signal });
    const body = response.body as Record<string, unknown> | null;
    if (!Array.isArray(body?.value)) throw DataError.create('MJD104', { operation: 'load', details: body }, 'no "value" array');
    return { rows: body.value as unknown[], total: body['@odata.count'], nextLink: body['@odata.nextLink'] };
  }

  // `$apply=filter(…)/aggregate(Freight with sum as s0, $count as s1)`: one row of values.
  private async loadSummary(options: LoadOptions): Promise<unknown[]> {
    const items = options.summary!;
    const apply = withValidValues('load', () => {
      const values = items.map((item, i) => (item.type === 'count' ? `$count as s${i}` : `${odataPath(item.field!)} with ${AGGREGATE[item.type]} as s${i}`));
      const filter = this.filterText(options);
      return `${filter === 'true' ? '' : `filter(${filter})/`}aggregate(${values.join(',')})`;
    });
    const response = await this.send({ operation: 'load', method: 'GET', url: this.url, query: { $apply: apply, ...requestParams(options) }, signal: options.signal });
    const row = (response.body as { value?: Record<string, unknown>[] } | null)?.value?.[0] ?? {};
    return items.map((item, i) => {
      const value = row[`s${i}`] ?? null;
      if (item.type === 'count' || item.type === 'sum') return Number(value ?? 0);
      return item.type === 'avg' && value !== null ? Number(value) : value;
    });
  }

  // A relative link is relative to the service root.
  private linkUrl(link: string): string {
    return /^([a-z][a-z\d+.-]*:|\/)/i.test(link) ? link : this.serviceRoot + link;
  }

  private itemUrl(key: K): string {
    if (this.odata.itemUrl) return this.odata.itemUrl(key);
    const fields = this.keys.fields;
    if (!fields?.length) throw new TypeError('a function key needs the itemUrl option');
    const literal = (field: string, value: unknown) => encodeURIComponent(odataLiteral(value, this.fields[field] ?? fieldTypeOf(value)));
    const parts = fields.length === 1 ? literal(fields[0], key) : fields.map((f) => `${f}=${literal(f, (key as Record<string, unknown>)?.[f])}`).join(',');
    return `${this.url}(${parts})`;
  }

  private writeHeaders(original: unknown, returnRow: boolean): Record<string, string> {
    const headers: Record<string, string> = { ...ODATA_HEADERS };
    const etag = isObject(original) ? original['@odata.etag'] : undefined;
    if (typeof etag === 'string') headers['If-Match'] = etag;
    if (returnRow && this.odata.returnSavedRow !== false) headers.Prefer = 'return=representation';
    return headers;
  }

  // Annotations stay out of the body; `date` fields go as days.
  private writeValues(values: Partial<T>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(values)) {
      if (name.startsWith('@odata.')) continue;
      out[name] = this.fields[name] === 'date' && value instanceof Date ? dayText(value) : value;
    }
    return out;
  }

  private readSaved(body: unknown, headers: Headers): Partial<T> | void {
    if (isObject(body)) return this.readEntity(body);
    // An answer without a body still carries the new version.
    const etag = headers.get('ETag');
    return etag ? ({ '@odata.etag': etag } as unknown as Partial<T>) : undefined;
  }

  private readEntity(body: Record<string, unknown>): T {
    const row = { ...body };
    delete row['@odata.context'];
    return this.odata.readRow ? this.odata.readRow(row) : (row as T);
  }
}

function selectText(fields: readonly string[] | undefined): string | undefined {
  return fields?.length ? fields.map(odataPath).join(',') : undefined;
}

function expandText(paths: readonly string[] | undefined): string | undefined {
  return paths?.length ? odataExpand(paths) : undefined;
}

function randomText(): string {
  return Math.random().toString(36).slice(2, 12);
}
