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

interface ValueTest {
  one: (v: unknown) => boolean;
  none: boolean;
}

function conditionTest(c: FilterCondition, ctx: EvaluateContext): (row: unknown) => boolean {
  const value = valueReader(c.field, ctx);
  // An empty field, an empty list of values too: `isblank`, and `=` / `<>` with an empty value.
  const askedEmpty = (c.op === '=' || c.op === '<>') && comparerOf(c, ctx).toComparable(c.value) === null;
  if (c.op === 'isblank' || c.op === 'isnotblank' || askedEmpty) {
    const blank = (row: unknown) => blankValue(value(row));
    return c.op === 'isblank' || c.op === '=' ? blank : (row) => !blank(row);
  }
  const test = valueTest(c, ctx);
  if (!test) return () => true;
  const { one, none } = test;
  // A field that holds several values (an array) matches when one of them does; with a negative operator (`<>`,
  // `notin`, `notcontains`), when none of them does.
  return (row) => {
    const v = value(row);
    const found = Array.isArray(v) ? v.some(one) : one(v);
    return none ? !found : found;
  };
}

/**
 * The test of one value against the condition, in its positive form (`=`, `in`, `contains`), and whether the operator
 * is the negative one; `null` when the condition keeps every row.
 */
function valueTest(c: FilterCondition, ctx: EvaluateContext): ValueTest | null {
  const cmp = comparerOf(c, ctx);
  const read = (v: unknown) => cmp.toComparable(v);

  switch (c.op) {
    case '=':
    case '<>': {
      const target = cmp.toComparable(c.value);
      return { one: (v) => cmp.equals(read(v), target), none: c.op === '<>' };
    }
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const target = cmp.toComparable(c.value);
      if (target === null) return { one: () => false, none: false };
      const accept = { '<': (n: number) => n < 0, '<=': (n: number) => n <= 0, '>': (n: number) => n > 0, '>=': (n: number) => n >= 0 }[c.op];
      return {
        one: (v) => {
          const x = read(v);
          return x !== null && accept(cmp.compare(x, target));
        },
        none: false,
      };
    }
    case 'between': {
      const [from, to] = (c.value as unknown[]).map((v) => cmp.toComparable(v));
      return {
        one: (v) => {
          const x = read(v);
          return x !== null && (from === null || cmp.compare(x, from) >= 0) && (to === null || cmp.compare(x, to) <= 0);
        },
        none: false,
      };
    }
    case 'in':
    case 'notin': {
      const targets = (c.value as unknown[]).map((v) => cmp.toComparable(v));
      return {
        one: (v) => {
          const x = read(v);
          return targets.some((t) => (t === null ? x === null : cmp.equals(x, t)));
        },
        none: c.op === 'notin',
      };
    }
    default:
      return textTest(c, ctx);
  }
}

/** How the condition's field compares: its declared type, else the type of the condition's value. */
function comparerOf(c: FilterCondition, ctx: EvaluateContext): ValueComparer {
  const sample = Array.isArray(c.value) ? c.value.find((v) => !isEmpty(v)) : c.value;
  return new ValueComparer(ctx.fields?.[c.field] ?? fieldTypeOf(sample), ctx.locale, !!c.caseSensitive);
}

function textTest(c: FilterCondition, ctx: EvaluateContext): ValueTest | null {
  const text = new ValueComparer('string', ctx.locale, !!c.caseSensitive);
  const target = text.toComparable(c.value) as string | null;
  // An empty value filters nothing out, like an empty filter box.
  if (target === null) return null;
  const matches =
    c.op === 'startswith' ? (s: string) => s.startsWith(target) : c.op === 'endswith' ? (s: string) => s.endsWith(target) : (s: string) => s.includes(target);
  return {
    one: (v) => {
      const s = text.toComparable(v) as string | null;
      return s !== null && matches(s);
    },
    none: c.op === 'notcontains',
  };
}

// The context's `filterValue` of the field, else the field itself.
function valueReader(field: string, ctx: EvaluateContext): (row: unknown) => unknown {
  return ctx.filterValue?.(field) ?? ((row) => getField(row, field));
}

/** An empty field: a blank value, or a list of values with none that is not blank (an empty one too). */
function blankValue(v: unknown): boolean {
  return Array.isArray(v) ? v.every(isBlank) : isBlank(v);
}

/** `null`, `undefined`, `NaN` and text of only spaces. */
function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && Number.isNaN(v));
}
