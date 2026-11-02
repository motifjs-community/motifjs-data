import { Query } from '@motifx/core';
import type { EvaluateContext } from './evaluate-context';
import type { SummaryItem } from './summary-item';
import { ValueComparer } from './value-comparer';
import { fieldTypeOf, getField, isEmpty } from './values';

/**
 * The summary values of `rows`, in the order of `items`. An empty set gives `0` for `count` and `sum`
 * and `null` for the others. A field is read through the context's `summaryValue` when it gives one.
 */
export function summarize<T>(rows: readonly T[], items: readonly SummaryItem[], ctx: EvaluateContext = {}): unknown[] {
  return items.map((item) => {
    if (item.type === 'count') return rows.length;
    const field = item.field!;
    const read = ctx.summaryValue?.(field) ?? ((row: unknown) => getField(row, field));
    const skip = item.skipEmpty !== false;
    const all = Query.from(rows).select((row) => read(row));
    if (item.type === 'sum' || item.type === 'avg') {
      const numbers = all
        .where((value) => !skip || !isEmpty(value))
        .select((value) => (isEmpty(value) ? 0 : Number(value)))
        .where((n) => !Number.isNaN(n))
        .toArray();
      const sum = Query.from(numbers).aggregate(0, (total, n) => total + n);
      return item.type === 'sum' ? sum : numbers.length ? sum / numbers.length : null;
    }
    const values = all.where((value) => !isEmpty(value)).toArray();
    const cmp = new ValueComparer(ctx.fields?.[field] ?? fieldTypeOf(values[0]), ctx.locale);
    const sign = item.type === 'min' ? -1 : 1;
    let best: unknown = null;
    let bestKey: ReturnType<ValueComparer['toComparable']> = null;
    for (const value of values) {
      const key = cmp.toComparable(value);
      if (key !== null && (bestKey === null || cmp.compare(key, bestKey) * sign > 0)) {
        best = value;
        bestKey = key;
      }
    }
    return best;
  });
}
