import type { FieldType } from './field-type';
import { dayNumber, isEmpty, toDate } from './values';

/** Compares values of one field type: text in the locale and without case, dates by day or moment. */
export class ValueComparer {
  private readonly collator: Intl.Collator;

  constructor(
    readonly type: FieldType,
    readonly locale: string | undefined,
    readonly caseSensitive = false,
  ) {
    this.collator = new Intl.Collator(locale, { numeric: true, sensitivity: caseSensitive ? 'variant' : 'base' });
  }

  /** `null` for empty values. */
  toComparable(v: unknown): string | number | boolean | null {
    if (isEmpty(v)) return null;
    switch (this.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isNaN(n) ? null : n;
      }
      case 'boolean':
        return typeof v === 'string' ? v.toLowerCase() === 'true' : !!v;
      case 'date':
        return dayNumber(v);
      case 'datetime':
        return toDate(v)?.getTime() ?? null;
      case 'guid':
        return String(v).toLowerCase();
      default: {
        const s = v instanceof Date ? v.toISOString() : String(v);
        return this.caseSensitive ? s : s.toLocaleLowerCase(this.locale);
      }
    }
  }

  compare(a: string | number | boolean, b: string | number | boolean): number {
    if (typeof a === 'string' && typeof b === 'string') return this.collator.compare(a, b);
    return Number(a) - Number(b);
  }

  equals(a: string | number | boolean | null, b: string | number | boolean | null): boolean {
    if (a === null || b === null) return a === b;
    if (typeof a === 'string' && typeof b === 'string') return a === b || this.collator.compare(a, b) === 0;
    return a === b;
  }
}
