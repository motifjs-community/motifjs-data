export interface OperationOptions {
  signal?: AbortSignal;
  params?: Readonly<Record<string, unknown>>;
}
