import type { EvaluateContext } from './evaluate-context';
import type { SummaryItem } from './summary-item';
import { ValueComparer } from './value-comparer';
import { fieldTypeOf, getField, isEmpty } from './values';

/** A summary value built one row at a time. */
export interface SummaryAccumulator {
  /** Adds a row with its value, the one `SummaryRule.value` reads. */
  add(value: unknown, row: unknown): void;
  result(): unknown;
}

/**
 * The summary values of `rows`, in the order of `items`. An empty set gives `0` for `count`, `countDistinct`
 * and `sum` and `null` for the others. A field is read through the context's `summaryValue` when it gives one.
 */
export function summarize<T>(rows: readonly T[], items: readonly SummaryItem[], ctx: EvaluateContext = {}): unknown[] {
  return items.map((item) => {
    const rule = new SummaryRule(item, ctx);
    const sum = rule.start();
    for (const row of rows) sum.add(rule.value(row), row);
    return sum.result();
  });
}

/**
 * How one summary item is computed. `start()` gives an accumulator for one set of rows; the accumulators of one rule
 * read the value the same way and order `min` and `max` by the same type, the one of the first value that is not empty.
 */
export class SummaryRule {
  private readonly read: (row: unknown) => unknown;
  private comparer: ValueComparer | null = null;

  /** `read` reads a row's value instead of the item's field (a computed value). */
  constructor(
    readonly item: SummaryItem,
    private readonly ctx: EvaluateContext = {},
    read?: (row: unknown) => unknown,
  ) {
    const field = item.field;
    // `count` reads nothing.
    this.read = item.type === 'count' ? () => undefined : (read ?? (field === undefined ? () => undefined : (ctx.summaryValue?.(field) ?? ((row: unknown) => getField(row, field)))));
  }

  /** The value of a row the item summarizes (`undefined` for `count`). */
  value(row: unknown): unknown {
    return this.read(row);
  }

  start(): SummaryAccumulator {
    switch (this.item.type) {
      case 'count': {
        let n = 0;
        return { add: () => void n++, result: () => n };
      }
      case 'sum':
      case 'avg': {
        const skip = this.item.skipEmpty !== false;
        const avg = this.item.type === 'avg';
        let sum = 0;
        let n = 0;
        return {
          add: (value) => {
            if (isEmpty(value)) {
              // Without `skipEmpty` an empty value counts as 0.
              if (!skip) n++;
              return;
            }
            const number = Number(value);
            if (Number.isNaN(number)) return;
            sum += number;
            n++;
          },
          result: () => (!avg ? sum : n ? sum / n : null),
        };
      }
      case 'countDistinct': {
        const seen = new Set<string | number | boolean>();
        return {
          add: (value) => {
            if (isEmpty(value)) return;
            const key = this.comparerOf(value).toComparable(value);
            if (key !== null) seen.add(key);
          },
          result: () => seen.size,
        };
      }
      default: {
        const sign = this.item.type === 'min' ? -1 : 1;
        let best: unknown = null;
        let bestKey: string | number | boolean | null = null;
        return {
          add: (value) => {
            if (isEmpty(value)) return;
            const cmp = this.comparerOf(value);
            const key = cmp.toComparable(value);
            if (key !== null && (bestKey === null || cmp.compare(key, bestKey) * sign > 0)) {
              best = value;
              bestKey = key;
            }
          },
          result: () => best,
        };
      }
    }
  }

  private comparerOf(value: unknown): ValueComparer {
    return (this.comparer ??= new ValueComparer(this.ctx.fields?.[this.item.field!] ?? fieldTypeOf(value), this.ctx.locale));
  }
}
