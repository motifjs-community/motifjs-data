export type BatchResult<T> = { ok: true; row?: Partial<T> | void } | { ok: false; error: unknown };
