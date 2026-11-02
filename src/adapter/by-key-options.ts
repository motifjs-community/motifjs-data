import type { OperationOptions } from './operation-options';

export interface ByKeyOptions extends OperationOptions {
  select?: readonly string[];
  expand?: readonly string[];
}
