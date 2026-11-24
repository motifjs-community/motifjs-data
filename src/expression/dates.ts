import { Day } from './day';

/** A moment's parts on the clock of a time zone. */
export interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  let format = zoneFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    zoneFormats.set(timeZone, format);
  }
  return format;
}

/** What the clock of the zone shows at an instant. */
export function zoneParts(instant: Date, timeZone: string): ZoneParts {
  const found: Record<string, number> = {};
  for (const part of zoneFormat(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') found[part.type] = Number(part.value);
  }
  return { year: found.year, month: found.month, day: found.day, hour: found.hour % 24, minute: found.minute, second: found.second };
}

function offsetAt(instant: Date, timeZone: string): number {
  const time = instant.getTime();
  const wholeSecond = time - (((time % 1000) + 1000) % 1000);
  const wall = zoneParts(new Date(wholeSecond), timeZone);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - wholeSecond;
}

/**
 * The instant at which the clock of the zone shows these parts; out-of-range parts move on as a calendar does. The
 * offset is resolved twice, so the days a clock jumps give a near, deterministic instant.
 */
export function fromZoneParts(parts: ZoneParts, timeZone: string): Date {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const first = new Date(asUtc - offsetAt(new Date(asUtc), timeZone));
  return new Date(asUtc - offsetAt(first, timeZone));
}

const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

const MOMENT_TEXT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * A day or a moment read from a value: a `Day` or `Date` as it is, `YYYY-MM-DD` as a day, a moment text with `Z` or an
 * offset as that instant, and one without a zone read on the clock of `timeZone`. `null` for `null`; `undefined` for
 * anything else.
 */
export function toTemporal(value: unknown, timeZone: string): Day | Date | null | undefined {
  if (value === null) return null;
  if (value instanceof Day) return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  const day = Day.parse(text);
  if (day) return day;
  const read = MOMENT_TEXT.exec(text);
  if (!read) return undefined;
  const [, year, month, dayPart, hour, minute, second, fraction, zone] = read;
  const parts: ZoneParts = {
    year: Number(year),
    month: Number(month),
    day: Number(dayPart),
    hour: Number(hour),
    minute: Number(minute),
    second: second ? Number(second) : 0,
  };
  const wrong = parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > daysIn(parts.year, parts.month) || parts.hour > 23 || parts.minute > 59 || parts.second > 59;
  if (wrong) return undefined;
  const ms = fraction ? Number(fraction.padEnd(3, '0')) : 0;
  if (!zone) return new Date(fromZoneParts(parts, timeZone).getTime() + ms);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, ms);
  if (zone === 'Z') return new Date(asUtc);
  const sign = zone[0] === '-' ? -1 : 1;
  const offset = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  return new Date(asUtc - offset * 60_000);
}

/** The day a moment falls on in the zone; a day as it is. */
export function dayOf(value: Day | Date, timeZone: string): Day {
  if (value instanceof Day) return value;
  const parts = zoneParts(value, timeZone);
  return new Day(parts.year, parts.month, parts.day);
}

/** The instant a day starts at in the zone; a moment as it is. */
export function instantOf(value: Day | Date, timeZone: string): Date {
  if (value instanceof Date) return value;
  return fromZoneParts({ year: value.year, month: value.month, day: value.day, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** `-1`, `0` or `1` ordering two days, two moments, or one of each: a day against a moment is its start in the zone. */
export function compareTemporal(a: Day | Date, b: Day | Date, timeZone: string): number {
  const difference = a instanceof Day && b instanceof Day ? a.serial - b.serial : instantOf(a, timeZone).getTime() - instantOf(b, timeZone).getTime();
  return difference < 0 ? -1 : difference > 0 ? 1 : 0;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

const DATE_TOKENS = ['yyyy', 'MMMM', 'dddd', 'MMM', 'ddd', 'yy', 'MM', 'dd', 'HH', 'mm', 'ss', 'M', 'd', 'H'];

const nameFormats = new Map<string, Intl.DateTimeFormat>();

function calendarName(culture: string, field: 'month' | 'weekday', width: 'long' | 'short', sample: Date): string {
  const key = `${culture}|${field}|${width}`;
  let format = nameFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(culture, { [field]: width, timeZone: 'UTC' });
    nameFormats.set(key, format);
  }
  return format.format(sample);
}

function dateToken(token: string, parts: ZoneParts, culture: string, sample: Date): string {
  switch (token) {
    case 'yyyy':
      return pad(parts.year, 4);
    case 'yy':
      return pad(parts.year % 100);
    case 'MMMM':
      return calendarName(culture, 'month', 'long', sample);
    case 'MMM':
      return calendarName(culture, 'month', 'short', sample);
    case 'MM':
      return pad(parts.month);
    case 'M':
      return String(parts.month);
    case 'dddd':
      return calendarName(culture, 'weekday', 'long', sample);
    case 'ddd':
      return calendarName(culture, 'weekday', 'short', sample);
    case 'dd':
      return pad(parts.day);
    case 'd':
      return String(parts.day);
    case 'HH':
      return pad(parts.hour);
    case 'H':
      return String(parts.hour);
    case 'mm':
      return pad(parts.minute);
    default:
      return pad(parts.second);
  }
}

/**
 * A day or moment written with a pattern of `yyyy yy MMMM MMM MM M dddd ddd dd d HH H mm ss`; text in single quotes is
 * written as it is, `''` writes one quote. A moment is read on the clock of `timeZone`; a day's clock parts are 0.
 * Month and weekday names come from the culture; without one, from `en-US`.
 */
export function formatDate(value: Day | Date, pattern: string, culture: string | undefined, timeZone: string): string {
  const parts = value instanceof Day ? { year: value.year, month: value.month, day: value.day, hour: 0, minute: 0, second: 0 } : zoneParts(value, timeZone);
  const names = culture ?? 'en-US';
  const sample = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  let out = '';
  let at = 0;
  while (at < pattern.length) {
    if (pattern[at] === "'") {
      at++;
      let text = '';
      while (at < pattern.length) {
        if (pattern[at] !== "'") {
          text += pattern[at++];
        } else if (pattern[at + 1] === "'") {
          text += "'";
          at += 2;
        } else {
          at++;
          break;
        }
      }
      out += text === '' ? "'" : text;
      continue;
    }
    const token = DATE_TOKENS.find((t) => pattern.startsWith(t, at));
    if (token) {
      out += dateToken(token, parts, names, sample);
      at += token.length;
    } else {
      out += pattern[at++];
    }
  }
  return out;
}

const separatorCache = new Map<string, { decimal: string; group: string }>();

function separators(culture: string | undefined): { decimal: string; group: string } {
  const key = culture ?? '';
  let found = separatorCache.get(key);
  if (!found) {
    found = { decimal: '.', group: ',' };
    for (const part of new Intl.NumberFormat(culture ?? 'en-US', { useGrouping: true }).formatToParts(1234567.8)) {
      if (part.type === 'decimal') found.decimal = part.value;
      else if (part.type === 'group') found.group = part.value;
    }
    separatorCache.set(key, found);
  }
  return found;
}

const countOf = (text: string, wanted: string): number => {
  let found = 0;
  for (const c of text) if (c === wanted) found++;
  return found;
};

/**
 * A number written with a pattern of `0` (a required digit), `#` (an optional one), `,` (grouping), `.` (the decimal
 * point) and `%` (writes the number as a percentage); other characters stay as they are. Halves round away from zero.
 * The separators come from the culture; without one, from `en-US`.
 */
export function formatNumber(value: number, pattern: string, culture: string | undefined): string {
  let first = -1;
  let last = -1;
  for (let at = 0; at < pattern.length; at++) {
    if ('0#.,'.includes(pattern[at])) {
      if (first < 0) first = at;
      last = at;
    }
  }
  if (first < 0) return pattern;
  const prefix = pattern.slice(0, first);
  const suffix = pattern.slice(last + 1);
  const mask = pattern.slice(first, last + 1);
  const scaled = pattern.includes('%') ? value * 100 : value;
  if (!Number.isFinite(scaled)) return prefix + String(scaled) + suffix;
  const dot = mask.indexOf('.');
  const intMask = dot < 0 ? mask : mask.slice(0, dot);
  const fractionMask = dot < 0 ? '' : mask.slice(dot + 1);
  const maxFraction = Math.min(countOf(fractionMask, '0') + countOf(fractionMask, '#'), 20);
  const minFraction = Math.min(countOf(fractionMask, '0'), maxFraction);
  const fixed = Math.abs(scaled).toFixed(maxFraction);
  const dotAt = fixed.indexOf('.');
  let intDigits = dotAt < 0 ? fixed : fixed.slice(0, dotAt);
  let fractionDigits = dotAt < 0 ? '' : fixed.slice(dotAt + 1);
  while (fractionDigits.length > minFraction && fractionDigits.endsWith('0')) fractionDigits = fractionDigits.slice(0, -1);
  const minInt = countOf(intMask, '0');
  if (intDigits.length < minInt) intDigits = intDigits.padStart(minInt, '0');
  if (intDigits === '0' && minInt === 0 && fractionDigits !== '') intDigits = '';
  const symbols = separators(culture);
  const lastComma = intMask.lastIndexOf(',');
  if (lastComma >= 0) {
    const size = intMask.length - lastComma - 1 || 3;
    let grouped = '';
    for (let at = intDigits.length; at > 0; at -= size) {
      const piece = intDigits.slice(Math.max(0, at - size), at);
      grouped = grouped === '' ? piece : piece + symbols.group + grouped;
    }
    intDigits = grouped;
  }
  const sign = scaled < 0 && /[1-9]/.test(fixed) ? '-' : '';
  return prefix + sign + intDigits + (fractionDigits === '' ? '' : symbols.decimal + fractionDigits) + suffix;
}
