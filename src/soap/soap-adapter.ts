import type { BatchResult } from '../adapter/batch-result';
import type { ByKeyOptions } from '../adapter/by-key-options';
import type { Capabilities } from '../adapter/capabilities';
import type { Change } from '../adapter/change';
import type { OperationOptions } from '../adapter/operation-options';
import type { WriteOptions } from '../adapter/write-options';
import { DataError } from '../errors/data-error';
import type { DataOperation } from '../errors/data-operation';
import { withValidValues } from '../errors/with-valid-values';
import { absoluteUrl } from '../http/absolute-url';
import { HttpAdapter } from '../http/http-adapter';
import type { HttpResponse } from '../http/http-response';
import { requestParams } from '../http/request-params';
import type { LoadOptions } from '../query/load-options';
import type { LoadResult } from '../query/load-result';
import { isObject } from '../query/values';
import type { SoapAdapterOptions } from './soap-adapter-options';
import { childNamed, SoapReader } from './soap-reader';
import { escapeXml, SoapWriter } from './soap-writer';

const SOAP11 = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP12 = 'http://www.w3.org/2003/05/soap-envelope';
const ADDRESSING = 'http://www.w3.org/2005/08/addressing';

/**
 * A SOAP service, such as a WCF `.svc` endpoint. Each part of the adapter contract calls a service
 * operation (`operations`); what the load operation does not handle runs in memory.
 */
export class SoapAdapter<T = Record<string, unknown>, K = unknown> extends HttpAdapter<T, K> {
  private readonly soap: SoapAdapterOptions<T, K>;
  private readonly namespace: string;
  private readonly writer: SoapWriter;
  private readonly reader: SoapReader;

  constructor(options: SoapAdapterOptions<T, K>) {
    super(options);
    this.soap = options;
    this.namespace = options.namespace ?? 'http://tempuri.org/';
    const lists = options.lists ?? {};
    this.writer = new SoapWriter({
      dataContract: options.serializer !== 'xml',
      dataNamespace: options.dataNamespace ?? this.namespace,
      firstFields: options.firstFields ?? [],
      lists,
    });
    this.reader = new SoapReader(lists);
    if (options.operations.save) this.saveBatch = (changes, operation) => this.sendBatch(changes, operation);
  }

  protected backendCapabilities(): Capabilities {
    const ops = this.soap.operations;
    const handles = ops.load.handles ?? [];
    return {
      filter: handles.includes('filter'),
      sort: handles.includes('sort'),
      paging: handles.includes('paging'),
      count: handles.includes('count'),
      select: handles.includes('select'),
      group: handles.includes('group'),
      summary: handles.includes('summary'),
      insert: !!(ops.insert || ops.save),
      update: !!(ops.update || ops.save),
      remove: !!(ops.remove || ops.save),
    };
  }

  protected async loadRows(options: LoadOptions): Promise<LoadResult<T>> {
    const load = this.soap.operations.load;
    const result = await this.call('load', load, () => load.args?.(options) ?? {}, options);
    const read: { rows: unknown[]; total?: number } = load.read ? load.read(result, options) : { rows: listOf(result) };
    return Array.isArray(read?.rows) ? { ...read, rows: read.rows.map((row) => this.readRow(row)) } : (read as LoadResult<T>);
  }

  protected override async findRow(key: K, options: ByKeyOptions): Promise<T | undefined> {
    const op = this.soap.operations.byKey;
    if (!op) return super.findRow(key, options);
    const result = await this.call('byKey', op, () => op.args(key), options);
    const row = op.read ? op.read(result) : isObject(result) ? result : undefined;
    return row ? this.readRow(row) : undefined;
  }

  protected override async insertRow(values: Partial<T>, options: OperationOptions): Promise<Partial<T> | void> {
    const op = this.soap.operations.insert;
    if (!op) return this.saveOne({ type: 'insert', data: values }, options);
    const result = await this.call('insert', op, () => op.args(values), options);
    if (op.read) return op.read(result);
    if (isObject(result)) return this.readRow(result);
    // A service that returns only the new key.
    const keyField = this.keys.fields?.length === 1 ? this.keys.fields[0] : undefined;
    return keyField && result !== null && result !== '' ? this.readRow({ [keyField]: result }) : undefined;
  }

  protected override async updateRow(key: K, changes: Partial<T>, options: WriteOptions<T>): Promise<Partial<T> | void> {
    const op = this.soap.operations.update;
    if (!op) return this.saveOne({ type: 'update', key, data: changes, original: options.original }, options);
    const result = await this.call('update', op, () => op.args(key, changes, options.original), options);
    if (op.read) return op.read(result);
    return isObject(result) ? this.readRow(result) : undefined;
  }

  protected override async removeRow(key: K, options: WriteOptions<T>): Promise<void> {
    const op = this.soap.operations.remove;
    if (!op) {
      await this.saveOne({ type: 'remove', key, original: options.original }, options);
      return;
    }
    await this.call('remove', op, () => op.args(key, options.original), options);
  }

  /** A fault in the body decides the error; otherwise the status does. */
  protected override readError(response: HttpResponse): DataError {
    const own = this.http.readError?.(response);
    if (own) return own;
    if (typeof response.body === 'string' && /<(\w+:)?Fault[\s>]/.test(response.body)) {
      try {
        const content = firstElement(this.envelopeBody(response));
        if (content?.localName === 'Fault') return this.faultError(content, response);
      } catch {
        // Not a readable envelope.
      }
    }
    return super.readError(response);
  }

  private async sendBatch(changes: readonly Change<T, K>[], options: OperationOptions): Promise<BatchResult<T>[]> {
    const op = this.soap.operations.save!;
    const result = await this.call('save', op, () => op.args(changes), options);
    if (!op.read) return changes.map(() => ({ ok: true }));
    return op.read(result).map((r) => (r.ok && isObject(r.row) ? { ok: true, row: this.readRow(r.row) } : r));
  }

  private async saveOne(change: Change<T, K>, options: OperationOptions): Promise<Partial<T> | void> {
    const [result] = await this.sendBatch([change], options);
    if (result && !result.ok) throw result.error;
    return result?.row;
  }

  private async call(operation: DataOperation, op: { name: string; action?: string }, args: () => Record<string, unknown>, options: OperationOptions) {
    const action = op.action ?? this.defaultAction(op.name);
    const body = withValidValues(operation, () => this.envelope(op.name, action, args()));
    const response = await this.send({
      operation,
      method: 'POST',
      url: this.soap.url,
      query: requestParams(options),
      headers: this.contentHeaders(action),
      body,
      signal: options.signal,
    });
    return this.readResult(op.name, response);
  }

  private envelope(name: string, action: string, args: Record<string, unknown>): string {
    const headers: string[] = [];
    if (this.soap.addressing) {
      headers.push(
        `<a:Action s:mustUnderstand="1">${escapeXml(action)}</a:Action>`,
        `<a:MessageID>urn:uuid:${randomUuid()}</a:MessageID>`,
        `<a:ReplyTo><a:Address>${ADDRESSING}/anonymous</a:Address></a:ReplyTo>`,
        `<a:To s:mustUnderstand="1">${escapeXml(absoluteUrl(this.soap.url))}</a:To>`,
      );
    }
    const extra = this.soap.soapHeader?.(name);
    if (extra) headers.push(extra);
    const namespaces = `xmlns:s="${this.soap.version === '1.2' ? SOAP12 : SOAP11}"${this.soap.addressing ? ` xmlns:a="${ADDRESSING}"` : ''}`;
    const header = headers.length ? `<s:Header>${headers.join('')}</s:Header>` : '';
    const body = this.writer.operation(name, this.namespace, args);
    return `<?xml version="1.0" encoding="utf-8"?><s:Envelope ${namespaces}>${header}<s:Body>${body}</s:Body></s:Envelope>`;
  }

  private contentHeaders(action: string): Record<string, string> {
    if (this.soap.version === '1.2') {
      return { Accept: 'application/soap+xml, text/xml', 'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"` };
    }
    return { Accept: 'text/xml', 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${action}"` };
  }

  private defaultAction(name: string): string {
    const base = this.namespace.endsWith('/') ? this.namespace : `${this.namespace}/`;
    return this.soap.contract ? `${base}${this.soap.contract}/${name}` : `${base}${name}`;
  }

  // WCF answers `<NameResponse><NameResult>…</NameResult></NameResponse>`.
  private readResult(name: string, response: HttpResponse): unknown {
    const content = firstElement(this.envelopeBody(response));
    if (!content) return null;
    if (content.localName === 'Fault') throw this.faultError(content, response);
    const result = childNamed(content, `${name}Result`) ?? (content.children.length === 1 ? content.children[0] : undefined);
    if (result) return this.reader.value(result);
    return content.children.length ? this.reader.value(content) : null;
  }

  private envelopeBody(response: HttpResponse): Element {
    const operation = response.request.operation;
    if (typeof DOMParser === 'undefined') throw DataError.create('MJD301', { operation }, 'read XML without a DOMParser');
    const text = typeof response.body === 'string' ? response.body : '';
    const root = new DOMParser().parseFromString(text, 'text/xml').documentElement;
    const body = root?.localName === 'Envelope' ? childNamed(root, 'Body') : undefined;
    if (!body) throw DataError.create('MJD104', { operation, status: response.status, details: text }, 'no SOAP envelope');
    return body;
  }

  private faultError(element: Element, response: HttpResponse): DataError {
    const fault = this.reader.fault(element);
    const operation = response.request.operation;
    const custom = this.soap.readFault?.(fault, operation);
    if (custom) return custom;
    const rejected = fault.code === 'Client' || fault.code === 'Sender';
    return DataError.create(rejected ? 'MJD202' : 'MJD201', { operation, status: response.status, details: fault }, fault.message);
  }

  // XML is text: declared number and boolean fields are converted.
  private readRow(row: unknown): T {
    for (const [field, type] of Object.entries(this.fields)) {
      if (type === 'number') convertText(row, field.split('.'), (text) => (text.trim() === '' ? text : Number(text)));
      if (type === 'boolean') convertText(row, field.split('.'), (text) => text === 'true' || text === '1');
    }
    return this.soap.readRow ? this.soap.readRow(row as Record<string, unknown>) : (row as T);
  }
}

// A path such as `Lines.Quantity` reaches into every item of a list.
function convertText(target: unknown, path: readonly string[], convert: (text: string) => unknown) {
  if (Array.isArray(target)) {
    for (const item of target) convertText(item, path, convert);
    return;
  }
  if (!isObject(target)) return;
  const [name, ...rest] = path;
  if (rest.length) convertText(target[name], rest, convert);
  else if (typeof target[name] === 'string') target[name] = convert(target[name]);
}

// A list result: an array, one item (its only field), or nothing.
function listOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result === null || result === undefined || result === '') return [];
  if (isObject(result)) {
    const values = Object.values(result);
    if (values.length === 1) return Array.isArray(values[0]) ? values[0] : [values[0]];
  }
  return [result];
}

function firstElement(element: Element): Element | undefined {
  return element.firstElementChild ?? undefined;
}

function randomUuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
