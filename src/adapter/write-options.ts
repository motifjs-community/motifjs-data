import type { OperationOptions } from './operation-options';

export interface WriteOptions<T> extends OperationOptions {
  /** The row itself, as it was read. Adapters that detect changes made elsewhere take its version from it (OData: `@odata.etag`). */
  original?: T;
}
