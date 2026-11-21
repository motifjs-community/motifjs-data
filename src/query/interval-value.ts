import type { PivotInterval } from './pivot-interval';
import { isEmpty, toDate } from './values';

const DATE_PARTS: readonly unknown[] = ['year', 'quarter', 'month', 'day', 'dayOfWeek', 'date'];

/** Whether a value is a `PivotInterval` (or `undefined`, no interval). */
export function isPivotInterval(value: unknown): value is PivotInterval | undefined {
  return value === undefined || DATE_PARTS.includes(value) || (typeof value === 'number' && Number.isFinite(value) && value > 0);
}

/** The value of a level's interval; `null` for an empty value or one the interval cannot read. */
export function intervalValue(value: unknown, interval: PivotInterval | undefined): unknown {
  if (isEmpty(value)) return null;
  if (interval === undefined) return value;
  if (typeof interval === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? rangeStart(n, interval) : null;
  }
  const d = toDate(value);
  if (!d) return null;
  switch (interval) {
    case 'year':
      return d.getFullYear();
    case 'quarter':
      return Math.floor(d.getMonth() / 3) + 1;
    case 'month':
      return d.getMonth() + 1;
    case 'day':
      return d.getDate();
    case 'dayOfWeek':
      return d.getDay();
    default:
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
}

// Exact for the decimals the numbers are written with: 0.3 in ranges of 0.1 starts at 0.3, not 0.2.
function rangeStart(n: number, width: number): number {
  const places = Math.max(decimals(n), decimals(width));
  if (places === 0 || places > 15) return Math.floor(n / width) * width;
  const scale = 10 ** places;
  const w = Math.round(width * scale);
  return (Math.floor(Math.round(n * scale) / w) * w) / scale;
}

function decimals(n: number): number {
  const [digits, exponent] = String(n).split('e');
  const dot = digits.indexOf('.');
  return Math.max(0, (dot < 0 ? 0 : digits.length - dot - 1) - Number(exponent ?? 0));
}
