import type { BatchResult } from '../adapter/batch-result';
import type { ByKeyOptions } from '../adapter/by-key-options';
import type { Capabilities } from '../adapter/capabilities';
import type { Change } from '../adapter/change';
import type { OperationOptions } from '../adapter/operation-options';
import { DataError } from '../errors/data-error';
import { HttpAdapter } from '../http/http-adapter';
import { requestParams } from '../http/request-params';
import type { LoadOptions } from '../query/load-options';
import type { LoadResult } from '../query/load-result';
import type { RestAdapterOptions } from './rest-adapter-options';
import { defaultLoadQuery, defaultReadRows, defaultReadSaved } from './rest-defaults';

/**
 * A REST endpoint: `GET url` loads, `GET url/key` finds, `POST url` inserts, `PATCH url/key` updates,
 * `DELETE url/key` removes. Use `capabilities` to say what the endpoint cannot do.
 */
export class RestAdapter<T = Record<string, unknown>, K = unknown> extends HttpAdapter<T, K> {
  private readonly rest: RestAdapterOptions<T, K>;

  constructor(options: RestAdapterOptions<T, K>) {
    super(options);
    this.rest = options;
    if (options.batch) this.saveBatch = (changes, operation) => this.sendBatch(changes, operation);
  }

  protected backendCapabilities(): Capabilities {
    return { filter: true, sort: true, paging: true, count: true, select: true, group: false, summary: false, insert: true, update: true, remove: true };
  }

  protected async loadRows(options: LoadOptions): Promise<LoadResult<T>> {
    const query = { ...(this.rest.loadQuery ?? defaultLoadQuery)(options), ...(options.params as Record<string, string>) };
    const response = await this.send({ operation: 'load', method: 'GET', url: this.rest.url, query, signal: options.signal });
    return (this.rest.readRows ?? defaultReadRows<T>)(response.body, options, response);
  }

  protected override async findRow(key: K, options: ByKeyOptions): Promise<T | undefined> {
    try {
      const query = { select: options.select?.join(','), expand: options.expand?.join(','), ...(options.params as Record<string, string>) };
      const response = await this.send({ operation: 'byKey', method: 'GET', url: this.itemUrl(key), query, signal: options.signal });
      return (response.body ?? undefined) as T | undefined;
    } catch (error) {
      if (error instanceof DataError && error.code === 'MJD204') return undefined;
      throw error;
    }
  }

  protected override async insertRow(values: Partial<T>, options: OperationOptions): Promise<Partial<T> | void> {
    const response = await this.send({ operation: 'insert', method: 'POST', url: this.rest.url, data: values, query: requestParams(options), signal: options.signal });
    return this.readSaved(response.body);
  }

  protected override async updateRow(key: K, changes: Partial<T>, options: OperationOptions): Promise<Partial<T> | void> {
    const method = this.rest.updateMethod ?? 'PATCH';
    const response = await this.send({ operation: 'update', method, url: this.itemUrl(key), data: changes, query: requestParams(options), signal: options.signal });
    return this.readSaved(response.body);
  }

  protected override async removeRow(key: K, options: OperationOptions): Promise<void> {
    await this.send({ operation: 'remove', method: 'DELETE', url: this.itemUrl(key), query: requestParams(options), signal: options.signal });
  }

  private async sendBatch(changes: readonly Change<T, K>[], options: OperationOptions): Promise<BatchResult<T>[]> {
    const batch = this.rest.batch!;
    const response = await this.send({
      operation: 'save',
      method: batch.method ?? 'POST',
      url: batch.url,
      data: batch.write(changes),
      query: requestParams(options),
      signal: options.signal,
    });
    return batch.read(response.body, changes);
  }

  private itemUrl(key: K): string {
    if (this.rest.itemUrl) return this.rest.itemUrl(key);
    const fields = this.keys.isComposite ? this.keys.fields! : null;
    const parts = fields ? fields.map((f) => (key as Record<string, unknown>)[f]) : [key];
    return `${this.rest.url.replace(/\/$/, '')}/${parts.map((p) => encodeURIComponent(String(p))).join('/')}`;
  }

  private readSaved(body: unknown): Partial<T> | void {
    return (this.rest.readSaved ?? defaultReadSaved<T>)(body);
  }
}
