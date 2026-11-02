import type { EvaluateContext } from '../query/evaluate-context';

export interface ODataFilterOptions extends Pick<EvaluateContext, 'fields' | 'locale'> {
  /** Text compares without case through `tolower()`, the value lowered in `locale`. Default `true`. */
  ignoreCase?: boolean;
}
