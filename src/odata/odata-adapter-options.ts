import type { HttpAdapterOptions } from '../http/http-adapter-options';
import type { ODataBatchOptions } from './odata-batch-options';

export interface ODataAdapterOptions<T, K> extends HttpAdapterOptions<T> {
  /** The entity set: `https://host/odata/Orders`. */
  url: string;
  /** Default: `url(5)`, `url('A-1')`, `url(orderId=7,line=2)`; key types come from `fields`. */
  itemUrl?: (key: K) => string;
  /** Default `'PATCH'`. */
  updateMethod?: 'PATCH' | 'PUT';
  /** Text filters compare without case through `tolower()`. Default `true`. */
  ignoreCase?: boolean;
  /** Asks for the saved row back (`Prefer: return=representation`). Default `true`. */
  returnSavedRow?: boolean;
  /** Loads the following pages when the service answers in pages (`@odata.nextLink`). Default `true`. */
  followNextLink?: boolean;
  /** Changes each row read from the service, e.g. date strings into `Date`s. */
  readRow?: (row: Record<string, unknown>) => T;
  /** The service supports `$apply` (OData Data Aggregation): summaries are computed there. Default `false`. */
  aggregation?: boolean;
  /** Saves many changes in one `$batch` request. */
  batch?: boolean | ODataBatchOptions;
}
