import type { FilterCondition } from './filter-condition';
import type { FilterExpression } from './filter-expression';
import type { FilterOperator } from './filter-operator';
import { validateFilter } from './filter-validation';

export function where(field: string, op: FilterOperator, value?: unknown, caseSensitive?: boolean): FilterCondition {
  const condition: FilterCondition = { field, op };
  if (value !== undefined) condition.value = value;
  if (caseSensitive) condition.caseSensitive = true;
  return condition;
}

/** Empty and missing expressions are left out; `null` when nothing is left. */
export function and(...items: (FilterExpression | null | undefined)[]): FilterExpression | null {
  return join('and', items);
}

export function or(...items: (FilterExpression | null | undefined)[]): FilterExpression | null {
  return join('or', items);
}

export function not(item: FilterExpression): FilterExpression {
  return { not: item };
}

/** A filter no row passes (an `or` of nothing): a search that matched no field. */
export function none(): FilterExpression {
  return { or: [] };
}

export function isCondition(e: FilterExpression): e is FilterCondition {
  return typeof (e as FilterCondition).field === 'string';
}

/** Whether a value is a filter expression: a condition with a known operator, or `and`, `or`, `not` of them. */
export function isFilterExpression(value: unknown): value is FilterExpression {
  try {
    validateFilter(value);
    return true;
  } catch {
    return false;
  }
}

export function fieldsInFilter(e: FilterExpression | null | undefined, out = new Set<string>()): Set<string> {
  if (!e) return out;
  if (isCondition(e)) out.add(e.field);
  else if ('and' in e) e.and.forEach((x) => fieldsInFilter(x, out));
  else if ('or' in e) e.or.forEach((x) => fieldsInFilter(x, out));
  else fieldsInFilter(e.not, out);
  return out;
}

function join(kind: 'and' | 'or', items: (FilterExpression | null | undefined)[]): FilterExpression | null {
  const list = items.filter((x): x is FilterExpression => !!x);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  return kind === 'and' ? { and: list } : { or: list };
}
