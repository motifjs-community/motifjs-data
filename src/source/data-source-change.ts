/**
 * What changed. `query`: a new query started (filter, sort, search, groups, params). `reload`: `reload()`
 * started. `loading`: a load started. `loaded`: rows arrived. `failed`: a load failed (`error`).
 * `cleared`: the rows were dropped for a new query. `rows`: loaded rows changed, or rows came or went.
 * `summary`: the summary values arrived.
 */
export interface DataSourceChange<T> {
  reason: 'query' | 'reload' | 'loading' | 'loaded' | 'failed' | 'cleared' | 'rows' | 'summary';
  /** `rows`: the loaded rows whose values changed. */
  rows?: readonly T[];
}
