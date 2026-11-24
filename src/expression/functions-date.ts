import type { ZoneParts } from './dates';
import { dayOf, formatDate, formatNumber, fromZoneParts, instantOf, toTemporal, zoneParts } from './dates';
import { Day } from './day';
import type { ExpressionFunction, RunContext } from './expression-function';
import type { ExpressionType } from './expression-type';
import { ANY, DATE, DATETIME, NUMBER, TEXT, nullable } from './expression-type';

function readTemporal(value: unknown, param: string, ctx: RunContext): Day | Date | null {
  const found = toTemporal(value, ctx.timeZone);
  if (found !== undefined) return found;
  ctx.fail(param, value);
}

function readNumber(value: unknown, param: string, ctx: RunContext): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  ctx.fail(param, value);
}

function readText(value: unknown, param: string, ctx: RunContext): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  ctx.fail(param, value);
}

const partsOf = (value: Day | Date, ctx: RunContext): ZoneParts =>
  value instanceof Day ? { year: value.year, month: value.month, day: value.day, hour: 0, minute: 0, second: 0 } : zoneParts(value, ctx.timeZone);

const msOf = (value: Date): number => ((value.getTime() % 1000) + 1000) % 1000;

const lastOfMonth = (year: number, month: number): number => new Day(year, month + 1, 0).day;

const monthShift = (year: number, month: number, day: number, by: number): { year: number; month: number; day: number } => {
  const total = year * 12 + (month - 1) + by;
  const toYear = Math.floor(total / 12);
  const toMonth = ((total % 12) + 12) % 12 + 1;
  return { year: toYear, month: toMonth, day: Math.min(day, lastOfMonth(toYear, toMonth)) };
};

const sameKind = (args: ExpressionType[]): ExpressionType => {
  const first = args[0];
  if (first && (first.name === 'date' || first.name === 'datetime' || first.name === 'null')) return first;
  return ANY;
};

const readKind = (of: ExpressionType) => (args: ExpressionType[]): ExpressionType => {
  const first = args[0];
  return first && (first.name === 'text' || first.name === 'any' || first.name === 'null' || first.nullable) ? nullable(of) : of;
};

const partFunction = (name: string, pick: (parts: ZoneParts) => number, description: string, example: string): ExpressionFunction => ({
  name,
  category: 'date',
  params: [{ name: 'value', kinds: ['temporal'] }],
  returns: () => NUMBER,
  run: ([value], ctx) => {
    const found = readTemporal(value, 'value', ctx);
    return found === null ? null : pick(partsOf(found, ctx));
  },
  description,
  example,
});

const shiftTimeFunction = (name: string, unit: number, param: string, description: string, example: string): ExpressionFunction => ({
  name,
  category: 'date',
  params: [
    { name: 'value', kinds: ['temporal'] },
    { name: param, kinds: ['number'] },
  ],
  returns: () => DATETIME,
  run: ([value, count], ctx) => {
    const found = readTemporal(value, 'value', ctx);
    const by = readNumber(count, param, ctx);
    if (found === null || by === null) return null;
    return new Date(instantOf(found, ctx.timeZone).getTime() + Math.round(by * unit));
  },
  description,
  example,
});

/** The day and moment functions of the library, and `format` for numbers and them both. */
export const DATE_FUNCTIONS: ExpressionFunction[] = [
  {
    name: 'now',
    category: 'date',
    params: [],
    returns: () => DATETIME,
    run: (_, ctx) => ctx.now,
    description: 'The moment the evaluation was given as now.',
    example: "formatDate(now(), 'HH:mm')",
  },
  {
    name: 'today',
    category: 'date',
    params: [],
    returns: () => DATE,
    run: (_, ctx) => dayOf(ctx.now, ctx.timeZone),
    description: 'The day of the current moment in the time zone of the evaluation.',
    example: 'diffDays(today(), item.dueOn)',
  },
  {
    name: 'date',
    category: 'date',
    params: [
      { name: 'value', kinds: ['number', 'text', 'temporal'] },
      { name: 'month', kinds: ['number'], optional: true },
      { name: 'day', kinds: ['number'], optional: true },
    ],
    returns: readKind(DATE),
    run: ([value, month, day], ctx) => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'number') {
        const toMonth = readNumber(month, 'month', ctx);
        const toDay = readNumber(day, 'day', ctx);
        return new Day(value, toMonth ?? 1, toDay ?? 1);
      }
      const found = toTemporal(value, ctx.timeZone);
      if (found === undefined) return typeof value === 'string' ? null : ctx.fail('value', value);
      return found === null ? null : dayOf(found, ctx.timeZone);
    },
    description: 'A day from a year, a month and a day, from a text, or from the day a moment falls on; null for a text that is not a day.',
    example: 'date(2026, 1, 31)',
  },
  {
    name: 'datetime',
    category: 'date',
    params: [{ name: 'value', kinds: ['text', 'temporal'] }],
    returns: readKind(DATETIME),
    run: ([value], ctx) => {
      const found = toTemporal(value, ctx.timeZone);
      if (found === undefined) return typeof value === 'string' ? null : ctx.fail('value', value);
      return found === null ? null : instantOf(found, ctx.timeZone);
    },
    description: 'A moment read from a text, or the start of a day in the time zone; null for a text that is not a moment.',
    example: "datetime('2026-01-31 09:30')",
  },
  partFunction('year', (parts) => parts.year, 'The year of a day or moment, read in the time zone.', 'year(today())'),
  partFunction('month', (parts) => parts.month, 'The month of a day or moment, 1 to 12, read in the time zone.', 'month(item.dueOn)'),
  partFunction('day', (parts) => parts.day, 'The day of the month of a day or moment, read in the time zone.', 'day(today())'),
  partFunction('hour', (parts) => parts.hour, 'The hour of a moment in the time zone; 0 for a day.', 'hour(now())'),
  partFunction('minute', (parts) => parts.minute, 'The minute of a moment in the time zone; 0 for a day.', 'minute(now())'),
  {
    name: 'weekday',
    category: 'date',
    params: [{ name: 'value', kinds: ['temporal'] }],
    returns: () => NUMBER,
    run: ([value], ctx) => {
      const found = readTemporal(value, 'value', ctx);
      return found === null ? null : dayOf(found, ctx.timeZone).weekday;
    },
    description: 'The day of the week of a day or moment: Monday 1 to Sunday 7.',
    example: 'weekday(today()) <= 5',
  },
  {
    name: 'addDays',
    category: 'date',
    params: [
      { name: 'value', kinds: ['temporal'] },
      { name: 'days', kinds: ['number'] },
    ],
    returns: sameKind,
    run: ([value, days], ctx) => {
      const found = readTemporal(value, 'value', ctx);
      const by = readNumber(days, 'days', ctx);
      if (found === null || by === null) return null;
      const whole = Math.trunc(by);
      if (found instanceof Day) return found.addDays(whole);
      const parts = zoneParts(found, ctx.timeZone);
      return new Date(fromZoneParts({ ...parts, day: parts.day + whole }, ctx.timeZone).getTime() + msOf(found));
    },
    description: 'The day or moment that many calendar days later; a moment keeps its clock time in the time zone.',
    example: 'addDays(today(), 7)',
  },
  {
    name: 'addMonths',
    category: 'date',
    params: [
      { name: 'value', kinds: ['temporal'] },
      { name: 'months', kinds: ['number'] },
    ],
    returns: sameKind,
    run: ([value, months], ctx) => {
      const found = readTemporal(value, 'value', ctx);
      const by = readNumber(months, 'months', ctx);
      if (found === null || by === null) return null;
      const whole = Math.trunc(by);
      if (found instanceof Day) {
        const to = monthShift(found.year, found.month, found.day, whole);
        return new Day(to.year, to.month, to.day);
      }
      const parts = zoneParts(found, ctx.timeZone);
      const to = monthShift(parts.year, parts.month, parts.day, whole);
      return new Date(fromZoneParts({ ...parts, ...to }, ctx.timeZone).getTime() + msOf(found));
    },
    description: 'The day or moment that many months later, the day of the month clamped to the last day there is.',
    example: 'addMonths(date(2026, 1, 31), 1)',
  },
  shiftTimeFunction('addHours', 3_600_000, 'hours', 'The moment that many hours later; a day starts from its first moment in the time zone.', 'addHours(now(), 2)'),
  shiftTimeFunction('addMinutes', 60_000, 'minutes', 'The moment that many minutes later; a day starts from its first moment in the time zone.', 'addMinutes(now(), 90)'),
  {
    name: 'diffDays',
    category: 'date',
    params: [
      { name: 'from', kinds: ['temporal'] },
      { name: 'to', kinds: ['temporal'] },
    ],
    returns: () => NUMBER,
    run: ([a, b], ctx) => {
      const from = readTemporal(a, 'from', ctx);
      const to = readTemporal(b, 'to', ctx);
      if (from === null || to === null) return null;
      return dayOf(to, ctx.timeZone).serial - dayOf(from, ctx.timeZone).serial;
    },
    description: 'The calendar days from the first to the second, each taken as its day in the time zone.',
    example: 'diffDays(item.orderedOn, today())',
  },
  {
    name: 'diffMinutes',
    category: 'date',
    params: [
      { name: 'from', kinds: ['temporal'] },
      { name: 'to', kinds: ['temporal'] },
    ],
    returns: () => NUMBER,
    run: ([a, b], ctx) => {
      const from = readTemporal(a, 'from', ctx);
      const to = readTemporal(b, 'to', ctx);
      if (from === null || to === null) return null;
      return Math.trunc((instantOf(to, ctx.timeZone).getTime() - instantOf(from, ctx.timeZone).getTime()) / 60_000);
    },
    description: 'The whole minutes from the first to the second, cut toward zero.',
    example: 'diffMinutes(item.startedAt, now())',
  },
  {
    name: 'startOfMonth',
    category: 'date',
    params: [{ name: 'value', kinds: ['temporal'] }],
    returns: () => DATE,
    run: ([value], ctx) => {
      const found = readTemporal(value, 'value', ctx);
      if (found === null) return null;
      const day = dayOf(found, ctx.timeZone);
      return new Day(day.year, day.month, 1);
    },
    description: 'The first day of the month a day or moment falls in.',
    example: 'startOfMonth(today())',
  },
  {
    name: 'endOfMonth',
    category: 'date',
    params: [{ name: 'value', kinds: ['temporal'] }],
    returns: () => DATE,
    run: ([value], ctx) => {
      const found = readTemporal(value, 'value', ctx);
      if (found === null) return null;
      const day = dayOf(found, ctx.timeZone);
      return new Day(day.year, day.month, lastOfMonth(day.year, day.month));
    },
    description: 'The last day of the month a day or moment falls in.',
    example: 'endOfMonth(today())',
  },
  {
    name: 'formatDate',
    category: 'date',
    params: [
      { name: 'value', kinds: ['temporal'] },
      { name: 'pattern', kinds: ['text'] },
      { name: 'culture', kinds: ['text'], optional: true },
    ],
    returns: () => TEXT,
    run: ([value, pattern, culture], ctx) => {
      const found = readTemporal(value, 'value', ctx);
      const mask = readText(pattern, 'pattern', ctx);
      const names = readText(culture, 'culture', ctx) ?? ctx.culture;
      if (found === null || mask === null) return null;
      ctx.step(mask.length);
      const written = formatDate(found, mask, names, ctx.timeZone);
      ctx.checkText(written.length);
      return written;
    },
    description: 'A day or moment written with a pattern of yyyy, MM, dd, HH, mm and the like, the names from the culture.',
    example: "formatDate(addDays(today(), 1), 'dd MMMM yyyy', 'tr-TR')",
  },
  {
    name: 'format',
    category: 'text',
    params: [
      { name: 'value', kinds: ['number', 'temporal'] },
      { name: 'pattern', kinds: ['text'] },
      { name: 'culture', kinds: ['text'], optional: true },
    ],
    returns: () => TEXT,
    run: ([value, pattern, culture], ctx) => {
      const mask = readText(pattern, 'pattern', ctx);
      const names = readText(culture, 'culture', ctx) ?? ctx.culture;
      if (value === null || value === undefined || mask === null) return null;
      ctx.step(mask.length);
      let written: string;
      if (typeof value === 'number') {
        written = formatNumber(value, mask, names);
      } else {
        const found = readTemporal(value, 'value', ctx);
        if (found === null) return null;
        written = formatDate(found, mask, names, ctx.timeZone);
      }
      ctx.checkText(written.length);
      return written;
    },
    description: 'A number, day or moment written with a pattern, the separators and names from the culture.',
    example: "format(item.total, '#,##0.00')",
  },
];
