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
import { queryString } from '../http/query-string';
import { requestParams } from '../http/request-params';
import type { FieldType } from '../query/field-type';
import type { LoadOptions } from '../query/load-options';
import type { LoadResult } from '../query/load-result';
import { type PivotDepth, pivotDepths } from '../query/pivot';
import type { PivotGroup } from '../query/pivot-group';
import type { PivotLevel } from '../query/pivot-level';
import type { PivotLoadOptions } from '../query/pivot-load-options';
import { fieldTypeOf, getField, isObject } from '../query/values';
import type { BatchRequestPart } from './batch-request-part';
import type { BatchResponsePart } from './batch-response-part';
import { readBatch, writeBatch } from './multipart-batch';
import type { ODataAdapterOptions } from './odata-adapter-options';
import { toODataFilter } from './odata-filter';
import { dayText, odataExpand, odataLiteral, odataPath } from './odata-syntax';

// Sent with writes only: a read with no custom header needs no CORS preflight.
const ODATA_HEADERS = { 'OData-Version': '4.0', 'OData-MaxVersion': '4.0' };
const AGGREGATE = { count: '', countDistinct: 'countdistinct', sum: 'sum', min: 'min', max: 'max', avg: 'average' } as const;

/** A level a pivot request groups by, with the name its value has in the answer when it is computed. */
type GroupedLevel<T> = { level: PivotLevel<T>; alias: string };

/**
 * An OData v4 entity set. Filtering, sorting, paging, counting, `$select` and `$expand` run on the
 * service, summaries and pivots too with `aggregation`; updates and removes send the `@odata.etag`
 * of the `original` row as `If-Match`.
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
    const aggregation = !!this.odata.aggregation;
    return { filter: true, sort: true, paging: true, count: true, select: true, group: false, summary: aggregation, pivot: aggregation, insert: true, update: true, remove: true };
  }

  protected override pivotRemotely(options: PivotLoadOptions<T>): boolean {
    const compute = this.aggregationOptions.compute === true;
    const levels = [...(options.rows ?? []), ...(options.columns ?? [])];
    return super.pivotRemotely(options) && levels.every((level) => level.interval === undefined || (compute && level.interval !== 'dayOfWeek'));
  }

  // One `$apply` per pair of depths of the axes, e.g. rows by year and country under 2024, columns at their total:
  // `filter(…)/compute(year(OrderDate) as _r0)/filter(_r0 eq 2024)/groupby((_r0,ShipCountry),aggregate($count as _n,Freight with sum as _m0))`.
  protected override async loadPivotGroups(options: PivotLoadOptions<T>): Promise<unknown> {
    const pairs = withValidValues('load', () =>
      pivotDepths(options.rows ?? [], options.expandedRows).flatMap((r) =>
        pivotDepths(options.columns ?? [], options.expandedColumns).map((c) => ({ rows: r.depth, columns: c.depth, apply: this.pivotApply(options, r, c) })),
      ),
    );
    const applies = pairs.map((p) => p.apply);
    const read = async (apply: string) => (await this.send({ operation: 'load', method: 'GET', url: this.url, query: { $apply: apply, ...requestParams(options) }, signal: options.signal })).body;
    const bodies = this.aggregationOptions.batch && applies.length > 1 ? await this.sendReads(applies, options) : await Promise.all(applies.map(read));
    return bodies.flatMap((body, i) => {
      const value = (body as { value?: unknown } | null)?.value;
      if (!Array.isArray(value)) throw DataError.create('MJD104', { operation: 'load', details: body }, 'no "value" array');
      return value.map((record: Record<string, unknown>) => this.pivotGroup(record, options, pairs[i].rows, pairs[i].columns));
    });
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
    return o.filter ? toODataFilter(o.filter, { fields: this.fields, locale: this.locale, ignoreCase: this.odata.ignoreCase, collections: this.odata.collections }) : 'true';
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
      if (item.type === 'count' || item.type === 'countDistinct' || item.type === 'sum') return Number(value ?? 0);
      return item.type === 'avg' && value !== null ? Number(value) : value;
    });
  }

  private get aggregationOptions() {
    return typeof this.odata.aggregation === 'object' ? this.odata.aggregation : {};
  }

  private pivotApply(o: PivotLoadOptions<T>, r: PivotDepth, c: PivotDepth): string {
    const rows = (o.rows ?? []).slice(0, r.depth).map((level, i): GroupedLevel<T> => ({ level, alias: `_r${i}` }));
    const columns = (o.columns ?? []).slice(0, c.depth).map((level, j): GroupedLevel<T> => ({ level, alias: `_c${j}` }));
    const grouped = [...rows, ...columns];
    const steps: string[] = [];
    const filter = this.filterText({ filter: o.filter });
    if (filter !== 'true') steps.push(`filter(${filter})`);
    const computed = grouped.filter((g) => g.level.interval !== undefined);
    if (computed.length) steps.push(`compute(${computed.map((g) => `${intervalText(g.level)} as ${g.alias}`).join(',')})`);
    const under = [this.parentsText(rows, r.parents), this.parentsText(columns, c.parents)].filter((text) => text !== '');
    if (under.length) steps.push(`filter(${under.length === 1 ? under[0] : under.map((text) => `(${text})`).join(' and ')})`);
    const values = ['$count as _n'];
    (o.measures ?? []).forEach((m, k) => {
      if (m.type !== 'count' && m.type !== 'custom') values.push(`${odataPath(m.field!)} with ${AGGREGATE[m.type]} as _m${k}`);
    });
    const aggregate = `aggregate(${values.join(',')})`;
    steps.push(grouped.length ? `groupby((${grouped.map((g) => groupedText(g)).join(',')}),${aggregate})` : aggregate);
    return steps.join('/');
  }

  // `(_r0 eq 2024 and ShipCountry eq 'France') or (…)`: the rows under the members whose children a depth holds.
  private parentsText(grouped: readonly GroupedLevel<T>[], parents: PivotDepth['parents']): string {
    if (!parents) return '';
    const one = (path: readonly unknown[]) => path.map((key, k) => `${groupedText(grouped[k])} eq ${odataLiteral(key, keyType(grouped[k].level, key, this.fields))}`).join(' and ');
    return parents.length === 1 ? one(parents[0]) : parents.map((path) => `(${one(path)})`).join(' or ');
  }

  private pivotGroup(record: Record<string, unknown>, o: PivotLoadOptions<T>, rows: number, columns: number): PivotGroup {
    const key = (g: GroupedLevel<T>) => (g.level.interval === undefined ? getField(record, g.level.field) : record[g.alias]);
    return {
      rows: (o.rows ?? []).slice(0, rows).map((level, i) => key({ level, alias: `_r${i}` })),
      columns: (o.columns ?? []).slice(0, columns).map((level, j) => key({ level, alias: `_c${j}` })),
      count: Number(record._n ?? 0),
      values: (o.measures ?? []).map((m, k) => (m.type === 'count' ? record._n : (record[`_m${k}`] ?? null))),
    };
  }

  // Reads in one `$batch`, answers in their order; one that failed fails them all.
  private async sendReads(applies: readonly string[], options: PivotLoadOptions<T>): Promise<unknown[]> {
    const url = (typeof this.odata.batch === 'object' ? this.odata.batch.url : undefined) ?? `${this.serviceRoot}$batch`;
    const boundary = `batch_${randomText()}`;
    const requests = applies.map((apply): BatchRequestPart => {
      const query = new URLSearchParams({ $apply: apply });
      for (const [name, value] of Object.entries(requestParams(options) ?? {})) if (value !== undefined && value !== null) query.set(name, String(value));
      return { method: 'GET', url: absoluteUrl(`${this.url}?${queryString(query)}`), headers: { Accept: 'application/json' } };
    });
    const response = await this.send({
      operation: 'load',
      method: 'POST',
      url,
      headers: { ...ODATA_HEADERS, Accept: 'multipart/mixed', 'Content-Type': `multipart/mixed; boundary=${boundary}` },
      body: writeBatch(requests, boundary),
      signal: options.signal,
    });
    let answers: BatchResponsePart[];
    try {
      answers = readBatch(typeof response.body === 'string' ? response.body : '', response.headers.get('content-type') ?? '');
    } catch (error) {
      throw DataError.create('MJD104', { operation: 'load', details: response.body, cause: error }, (error as Error).message);
    }
    const byId = new Map(answers.filter((a) => a.contentId).map((a) => [a.contentId, a]));
    return applies.map((_, i) => {
      const answer = byId.get(String(i + 1)) ?? answers[i];
      if (!answer) throw DataError.create('MJD104', { operation: 'load', details: response.body }, `no answer to read ${i + 1} of the batch`);
      if (answer.status < 200 || answer.status >= 300) {
        throw this.readError({ request: response.request, status: answer.status, statusText: answer.statusText, headers: answer.headers, body: answer.body, durationMs: 0 });
      }
      return answer.body;
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

// A level with an interval is grouped by the name `compute` gave its value.
function groupedText(g: GroupedLevel<any>): string {
  return g.level.interval === undefined ? odataPath(g.level.field) : g.alias;
}

// Quarters with integer division; a range starts at `floor(value / width) * width`, the division taken in decimals.
function intervalText(level: PivotLevel<any>): string {
  const field = odataPath(level.field);
  switch (level.interval) {
    case 'year':
      return `year(${field})`;
    case 'quarter':
      return `(month(${field}) add 2) div 3`;
    case 'month':
      return `month(${field})`;
    case 'day':
      return `day(${field})`;
    case 'date':
      return `date(${field})`;
    case 'dayOfWeek':
    case undefined:
      throw new TypeError(`no OData function groups ${level.interval ?? 'without an interval'}`);
    default: {
      const width = String(level.interval);
      return `floor(${field} div ${/[.e]/.test(width) ? width : `${width}.0`}) mul ${width}`;
    }
  }
}

function keyType(level: PivotLevel<any>, key: unknown, fields: Readonly<Record<string, FieldType>>): FieldType {
  if (level.interval === 'date') return 'date';
  if (level.interval !== undefined) return 'number';
  return fields[level.field] ?? fieldTypeOf(key);
}
