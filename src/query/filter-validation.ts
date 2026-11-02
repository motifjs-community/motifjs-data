import type { FilterExpression } from './filter-expression';

const OPERATORS = new Set([
  '=',
  '<>',
  '<',
  '<=',
  '>',
  '>=',
  'contains',
  'notcontains',
  'startswith',
  'endswith',
  'between',
  'in',
  'notin',
  'isblank',
  'isnotblank',
]);

export function validateFilter(e: unknown, path = 'filter'): asserts e is FilterExpression {
  if (!e || typeof e !== 'object') throw new TypeError(`${path} must be an object`);
  const x = e as Record<string, unknown>;
  if (typeof x.field === 'string') {
    if (!OPERATORS.has(x.op as string)) throw new TypeError(`${path}: unknown operator "${String(x.op)}"`);
    if (x.op === 'between' && !(Array.isArray(x.value) && x.value.length === 2)) throw new TypeError(`${path}: "between" needs [from, to]`);
    if ((x.op === 'in' || x.op === 'notin') && !Array.isArray(x.value)) throw new TypeError(`${path}: "${x.op}" needs an array`);
    return;
  }
  if (Array.isArray(x.and)) return x.and.forEach((c, i) => validateFilter(c, `${path}.and[${i}]`));
  if (Array.isArray(x.or)) return x.or.forEach((c, i) => validateFilter(c, `${path}.or[${i}]`));
  if (x.not !== undefined) return validateFilter(x.not, `${path}.not`);
  throw new TypeError(`${path} must be a condition ({ field, op, value }) or { and }, { or }, { not }`);
}
