import type { EvaluateContext } from '../query/evaluate-context';

export interface ODataFilterOptions extends Pick<EvaluateContext, 'fields' | 'locale'> {
  /** Text compares without case through `tolower()`, the value lowered in `locale`. Default `true`. */
  ignoreCase?: boolean;
  /**
   * Fields that hold a list of values (collections, such as `Tags`), their type in `fields` the type of the values: a
   * condition holds when one of the values passes it (`Tags/any(x: x eq 'a')`), with `<>`, `notin` and `notcontains`
   * when none does; a list is blank when none of its values is not blank, an empty list too.
   */
  collections?: readonly string[];
}
