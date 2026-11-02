/** `idle` until the first `load`. `error` when the rows could not be loaded (see `error`). */
export type DataSourceStatus = 'idle' | 'loading' | 'ready' | 'error';
