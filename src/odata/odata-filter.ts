import { isCondition } from '../query/filter-builders';
import type { FilterCondition } from '../query/filter-condition';
import type { FilterExpression } from '../query/filter-expression';
import { validateFilter } from '../query/filter-validation';
import { fieldTypeOf, isEmpty } from '../query/values';
import type { ODataFilterOptions } from './odata-filter-options';
import { odataLiteral, odataPath } from './odata-syntax';

// `true` keeps every row and `false` none; inside `and` / `or` they drop out.
type Part = string | boolean;

const COMPARE = { '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge' } as const;

/**
 * The filter as an OData v4 `$filter` that keeps the rows it keeps in memory; `'true'` when it keeps
 * every row. Throws a `TypeError` for a value its field type cannot hold.
 */
export function toODataFilter(filter: FilterExpression, options: ODataFilterOptions = {}): string {
  validateFilter(filter);
  return String(write(filter, options, false));
}

function write(e: FilterExpression, o: ODataFilterOptions, nested: boolean): Part {
  if (isCondition(e)) return condition(e, o);
  if ('not' in e) {
    const inner = write(e.not, o, true);
    return typeof inner === 'boolean' ? !inner : `not ${inner.startsWith('(') ? inner : `(${inner})`}`;
  }
  const op = 'and' in e ? 'and' : 'or';
  const parts = ('and' in e ? e.and : e.or).map((x) => write(x, o, true));
  // A false part decides an `and`, a true part decides an `or`.
  const decides = op === 'or';
  if (parts.includes(decides)) return decides;
  const text = parts.filter((p): p is string => typeof p === 'string');
  if (text.length === 0) return !decides;
  if (text.length === 1) return text[0];
  return nested ? `(${text.join(` ${op} `)})` : text.join(` ${op} `);
}

function condition(c: FilterCondition, o: ODataFilterOptions): Part {
  const path = odataPath(c.field);
  const declared = o.fields?.[c.field];
  const sample = Array.isArray(c.value) ? c.value.find((v) => !isEmpty(v)) : c.value;
  const textOp = c.op === 'contains' || c.op === 'notcontains' || c.op === 'startswith' || c.op === 'endswith';
  const type = textOp ? 'string' : (declared ?? fieldTypeOf(sample));
  const lower = type === 'string' && o.ignoreCase !== false && !c.caseSensitive;
  const field = lower ? `tolower(${path})` : path;
  const literal = (v: unknown) => (lower ? odataLiteral(textOf(v).toLocaleLowerCase(o.locale), 'string') : odataLiteral(v, type));

  // Blank is null, and for text also empty or only spaces. Without a declared type only text values tell.
  const isText = declared ? declared === 'string' : typeof sample === 'string';
  const blank = isText ? `(${path} eq null or trim(${path}) eq '')` : `${path} eq null`;
  const notBlank = isText ? `(${path} ne null and trim(${path}) ne '')` : `${path} ne null`;

  switch (c.op) {
    case 'isblank':
      return blank;
    case 'isnotblank':
      return notBlank;
    case '=':
      return isEmpty(c.value) ? blank : `${field} eq ${literal(c.value)}`;
    case '<>':
      return isEmpty(c.value) ? notBlank : `${field} ne ${literal(c.value)}`;
    case '<':
    case '<=':
    case '>':
    case '>=':
      return isEmpty(c.value) ? false : `${field} ${COMPARE[c.op]} ${literal(c.value)}`;
    case 'between': {
      const [from, to] = c.value as unknown[];
      const ends = [isEmpty(from) ? '' : `${field} ge ${literal(from)}`, isEmpty(to) ? '' : `${field} le ${literal(to)}`].filter(Boolean);
      if (ends.length === 0) return `${path} ne null`;
      return ends.length === 1 ? ends[0] : `(${ends.join(' and ')})`;
    }
    case 'in':
    case 'notin': {
      const values = c.value as unknown[];
      if (values.length === 0) return c.op === 'notin';
      const [compare, join] = c.op === 'in' ? ['eq', ' or '] : ['ne', ' and '];
      const each = values.map((v) => (isEmpty(v) ? `${path} ${compare} null` : `${field} ${compare} ${literal(v)}`));
      return each.length === 1 ? each[0] : `(${each.join(join)})`;
    }
    default: {
      // An empty value filters nothing out, like an empty filter box.
      if (isEmpty(c.value)) return true;
      const test = `${c.op === 'notcontains' ? 'contains' : c.op}(${field},${literal(c.value)})`;
      return c.op === 'notcontains' ? `(${path} eq null or not ${test})` : test;
    }
  }
}

function textOf(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}
