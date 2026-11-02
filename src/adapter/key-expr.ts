/** A field, several fields (the key is then an object of them), or a function of the row. */
export type KeyExpr<T> = string | readonly string[] | ((row: T) => unknown);
