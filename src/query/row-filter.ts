import type { EvaluateContext } from './evaluate-context';
import { isCondition } from './filter-builders';
import type { FilterCondition } from './filter-condition';
import type { FilterExpression } from './filter-expression';
import { validateFilter } from './filter-validation';
import { ValueComparer } from './value-comparer';
import { fieldTypeOf, getField, isEmpty } from './values';

/** A function that tests a row against the expression. Fields without a declared type take the type of the value. */
export function createRowFilter<T>(e: FilterExpression | null | undefined, ctx: EvaluateContext = {}): (row: T) => boolean {
  if (!e) return () => true;
  validateFilter(e);
  return buildTest(e, ctx) as (row: T) => boolean;
}

function buildTest(e: FilterExpression, ctx: EvaluateContext): (row: unknown) => boolean {
  if (isCondition(e)) return conditionTest(e, ctx);
  if ('and' in e) {
    const parts = e.and.map((x) => buildTest(x, ctx));
    return (row) => parts.every((test) => test(row));
  }
  if ('or' in e) {
    const parts = e.or.map((x) => buildTest(x, ctx));
    return (row) => parts.some((test) => test(row));
  }
  const inner = buildTest(e.not, ctx);
  return (row) => !inner(row);
}

function conditionTest(c: FilterCondition, ctx: EvaluateContext): (row: unknown) => boolean {
  const sample = Array.isArray(c.value) ? c.value.find((v) => !isEmpty(v)) : c.value;
  const cmp = new ValueComparer(ctx.fields?.[c.field] ?? fieldTypeOf(sample), ctx.locale, !!c.caseSensitive);
  const value = valueReader(c.field, ctx);
  const read = (row: unknown) => cmp.toComparable(value(row));
  const blank = (row: unknown) => isBlank(value(row));

  switch (c.op) {
    case 'isblank':
      return blank;
    case 'isnotblank':
      return (row) => !blank(row);
    case '=':
    case '<>': {
      const target = cmp.toComparable(c.value);
      const equal = (row: unknown) => (target === null ? blank(row) : cmp.equals(read(row), target));
      return c.op === '=' ? equal : (row) => !equal(row);
    }
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const target = cmp.toComparable(c.value);
      if (target === null) return () => false;
      const accept = { '<': (n: number) => n < 0, '<=': (n: number) => n <= 0, '>': (n: number) => n > 0, '>=': (n: number) => n >= 0 }[c.op];
      return (row) => {
        const v = read(row);
        return v !== null && accept(cmp.compare(v, target));
      };
    }
    case 'between': {
      const [from, to] = (c.value as unknown[]).map((v) => cmp.toComparable(v));
      return (row) => {
        const v = read(row);
        return v !== null && (from === null || cmp.compare(v, from) >= 0) && (to === null || cmp.compare(v, to) <= 0);
      };
    }
    case 'in':
    case 'notin': {
      const targets = (c.value as unknown[]).map((v) => cmp.toComparable(v));
      const found = (row: unknown) => {
        const v = read(row);
        return targets.some((t) => (t === null ? v === null : cmp.equals(v, t)));
      };
      return c.op === 'in' ? found : (row) => !found(row);
    }
    default:
      return textTest(c, ctx);
  }
}

function textTest(c: FilterCondition, ctx: EvaluateContext): (row: unknown) => boolean {
  const text = new ValueComparer('string', ctx.locale, !!c.caseSensitive);
  const target = text.toComparable(c.value) as string | null;
  // An empty value filters nothing out, like an empty filter box.
  if (target === null) return () => true;
  const matches =
    c.op === 'startswith' ? (s: string) => s.startsWith(target) : c.op === 'endswith' ? (s: string) => s.endsWith(target) : (s: string) => s.includes(target);
  const value = valueReader(c.field, ctx);
  const found = (row: unknown) => {
    const s = text.toComparable(value(row)) as string | null;
    return s !== null && matches(s);
  };
  return c.op === 'notcontains' ? (row) => !found(row) : found;
}

// The context's `filterValue` of the field, else the field itself.
function valueReader(field: string, ctx: EvaluateContext): (row: unknown) => unknown {
  return ctx.filterValue?.(field) ?? ((row) => getField(row, field));
}

/** `null`, `undefined`, `NaN` and text of only spaces. */
function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && Number.isNaN(v));
}
