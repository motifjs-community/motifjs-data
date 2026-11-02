import { Emitter, Resilience, type Event as MotifEvent, type ResiliencePolicy } from '@motifx/core';
import { DataAdapter } from '../adapter/data-adapter';
import { DataError } from '../errors/data-error';
import type { HttpAdapterOptions } from './http-adapter-options';
import { errorForStatus, isTransientError, readErrorBody } from './http-errors';
import type { HttpRequest } from './http-request';
import type { HttpRequestInit } from './http-request-init';
import type { HttpResponse } from './http-response';
import { queryString } from './query-string';

const TIMED_OUT = Symbol('timed out');

/** Base class of REST, OData and SOAP adapters: every request goes through `send`. */
export abstract class HttpAdapter<T = Record<string, unknown>, K = unknown> extends DataAdapter<T, K> {
  protected readonly http: Readonly<HttpAdapterOptions<T>>;
  private readonly policy: ResiliencePolicy | null;
  private readonly requestingEmitter = new Emitter<HttpRequest>();
  private readonly respondedEmitter = new Emitter<HttpResponse>();

  readonly onRequesting: MotifEvent<HttpRequest> = this.requestingEmitter.event;
  readonly onResponded: MotifEvent<HttpResponse> = this.respondedEmitter.event;

  constructor(options: HttpAdapterOptions<T>) {
    super(options);
    this.http = { ...options };
    this.policy = options.resilience ?? (options.retry ? Resilience.create.retry({ shouldHandle: isTransientError, ...options.retry }) : null);
  }

  override dispose() {
    this.requestingEmitter.dispose();
    this.respondedEmitter.dispose();
    super.dispose();
  }

  /** Error statuses reject with a `DataError` (see `readError`). */
  protected async send(init: HttpRequestInit): Promise<HttpResponse> {
    const request = await this.createRequest(init);
    this.requestingEmitter.fire(request);
    if (!request.cancel) await this.http.beforeSend?.(request);
    if (request.cancel) throw DataError.create('MJD106', { operation: request.operation });
    try {
      return this.policy ? await this.policy.execute(() => this.sendOnce(request)) : await this.sendOnce(request);
    } catch (error) {
      throw DataError.from(error, request.operation);
    }
  }

  /** Override (or give the `readError` option) to read the backend's own error format. */
  protected readError(response: HttpResponse): DataError {
    const own = this.http.readError?.(response);
    if (own) return own;
    const { message, fields } = readErrorBody(response.body, this.http.errorTextLength);
    return errorForStatus(response, message, fields);
  }

  protected async readBody(raw: Response, request: HttpRequest): Promise<unknown> {
    if (raw.status === 204 || raw.status === 205) return null;
    const text = await raw.text();
    if (!text) return null;
    if (!/[/+]json\b/i.test(raw.headers.get('content-type') ?? '')) return text;
    try {
      return JSON.parse(text);
    } catch (error) {
      throw DataError.create('MJD104', { operation: request.operation, status: raw.status, details: text, cause: error }, 'the body is not valid JSON');
    }
  }

  private async createRequest(init: HttpRequestInit): Promise<HttpRequest> {
    const query = new URLSearchParams(init.query instanceof URLSearchParams ? init.query : undefined);
    if (init.query && !(init.query instanceof URLSearchParams)) {
      for (const [name, value] of Object.entries(init.query)) if (value !== undefined && value !== null) query.set(name, String(value));
    }
    const request: HttpRequest = {
      cancel: false,
      operation: init.operation,
      method: init.method,
      url: init.url,
      query,
      headers: new Headers({ Accept: 'application/json' }),
      data: init.data,
      body: init.body,
      credentials: this.http.credentials,
      signal: init.signal,
    };
    const configured = typeof this.http.headers === 'function' ? await this.http.headers(request) : this.http.headers;
    new Headers(configured).forEach((value, name) => request.headers.set(name, value));
    new Headers(init.headers).forEach((value, name) => request.headers.set(name, value));
    return request;
  }

  // Each try gets its own controller, aborted by the caller's signal or by the timeout.
  private async sendOnce(request: HttpRequest): Promise<HttpResponse> {
    const operation = request.operation;
    if (request.signal?.aborted) throw DataError.create('MJD105', { operation });
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener('abort', abort, { once: true });
    const timeoutMs = this.http.timeoutMs ?? 0;
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(TIMED_OUT), timeoutMs) : undefined;
    const started = Date.now();
    try {
      let body = request.body;
      if (body === undefined && request.data !== undefined) {
        body = JSON.stringify(request.data);
        if (!request.headers.has('content-type')) request.headers.set('Content-Type', 'application/json');
      }
      const query = queryString(request.query);
      const url = query ? `${request.url}${request.url.includes('?') ? '&' : '?'}${query}` : request.url;
      const send = this.http.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));

      let raw: Response;
      try {
        raw = await send(url, { method: request.method, headers: request.headers, body, credentials: request.credentials, signal: controller.signal });
      } catch (error) {
        if (controller.signal.reason === TIMED_OUT) throw DataError.create('MJD102', { operation, cause: error }, timeoutMs);
        throw error;
      }
      const response: HttpResponse = {
        request,
        status: raw.status,
        statusText: raw.statusText,
        headers: raw.headers,
        body: await this.readBody(raw, request),
        durationMs: Date.now() - started,
      };
      await this.http.afterReceive?.(response);
      this.respondedEmitter.fire(response);
      if (response.status < 200 || response.status >= 300) throw this.readError(response);
      return response;
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abort);
    }
  }
}
