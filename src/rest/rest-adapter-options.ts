import type { HttpAdapterOptions } from '../http/http-adapter-options';
import type { HttpResponse } from '../http/http-response';
import type { LoadOptions } from '../query/load-options';
import type { LoadResult } from '../query/load-result';
import type { RestBatch } from './rest-batch';

export interface RestAdapterOptions<T, K> extends HttpAdapterOptions<T> {
  url: string;
  /** Address of one row. Default: `url/key` (a composite key: one segment per field). */
  itemUrl?: (key: K) => string;
  /** Default `'PATCH'`. */
  updateMethod?: string;
  /** Default: `skip`, `take`, `count`, `sort` (`name,-date`), `filter` (JSON), `select`, `expand`. */
  loadQuery?: (options: LoadOptions) => Record<string, string | number | boolean | null | undefined>;
  /** Default: an array, or `rows`/`items`/`data`/`value` with `total`/`totalCount`/`count`. A total in a header is in `response.headers`. */
  readRows?: (body: unknown, options: LoadOptions, response: HttpResponse) => LoadResult<T>;
  /** Default: the body when it is an object. */
  readSaved?: (body: unknown) => Partial<T> | void;
  batch?: RestBatch<T, K>;
}
