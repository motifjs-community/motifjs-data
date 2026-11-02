import type { OperationOptions } from '../adapter/operation-options';

/** `params` of an operation, sent as query parameters. */
export function requestParams(options: OperationOptions): Record<string, string> | undefined {
  return options.params as Record<string, string> | undefined;
}
