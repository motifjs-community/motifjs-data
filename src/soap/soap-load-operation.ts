import type { LoadOptions } from '../query/load-options';
import type { LoadResult } from '../query/load-result';

export interface SoapLoadOperation<T> {
  name: string;
  /** Default: `namespace` + `contract/` + `name`. */
  action?: string;
  /** Gets only what `handles` names. Default: no arguments. */
  args?: (options: LoadOptions) => Record<string, unknown>;
  /** Default: the result is the list of rows. With `group` / `summary` in `handles`, also `groups` / `summary`. */
  read?: (result: unknown, options: LoadOptions) => LoadResult<T>;
  /** What the operation does itself; the rest runs in memory. Default: nothing. */
  handles?: readonly ('filter' | 'sort' | 'paging' | 'count' | 'select' | 'group' | 'summary')[];
}
