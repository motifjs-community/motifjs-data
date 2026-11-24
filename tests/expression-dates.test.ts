import { describe, expect, it } from 'vitest';
import { compareTemporal, dayOf, formatDate, formatNumber, fromZoneParts, instantOf, toTemporal, zoneParts } from '../src/expression/dates';
import { Day } from '../src/expression/day';
import type { RunContext } from '../src/expression/expression-function';
import { ANY, DATE, DATETIME, NUMBER, TEXT } from '../src/expression/expression-type';
import { DATE_FUNCTIONS } from '../src/expression/functions-date';

const istanbul = 'Europe/Istanbul';
const newYork = 'America/New_York';

/** A fixed context: 2026-03-15 13:30 on the clock of Istanbul. */
const context = (overrides: Partial<RunContext> = {}): RunContext => ({
  now: new Date('2026-03-15T10:30:00Z'),
  timeZone: istanbul,
  culture: 'tr-TR',
  step: () => {},
  checkList: () => {},
  checkText: () => {},
  fail: (param: string, value: unknown): never => {
    throw new Error(`bad ${param}: ${String(value)}`);
  },
  ...overrides,
});

const call = (name: string, args: unknown[], ctx: RunContext = context()): unknown => {
  const fn = DATE_FUNCTIONS.find((f) => f.name === name);
  if (!fn) throw new Error(`no function ${name}`);
  return fn.run(args, ctx);
};

const day = (text: string): Day => {
  const found = Day.parse(text);
  if (!found) throw new Error(`not a day: ${text}`);
  return found;
};

const iso = (value: unknown): string => (value as Date).toISOString();

describe('zoneParts and fromZoneParts', () => {
  it('reads the clock of a zone', () => {
    expect(zoneParts(new Date('2026-01-15T12:00:00Z'), istanbul)).toEqual({ year: 2026, month: 1, day: 15, hour: 15, minute: 0, second: 0 });
  });

  it('crosses midnight into the next day', () => {
    expect(zoneParts(new Date('2026-01-15T22:30:45Z'), istanbul)).toEqual({ year: 2026, month: 1, day: 16, hour: 1, minute: 30, second: 45 });
  });

  it('reads a zone behind the universal clock', () => {
    expect(zoneParts(new Date('2026-01-15T12:00:00Z'), newYork)).toEqual({ year: 2026, month: 1, day: 15, hour: 7, minute: 0, second: 0 });
  });

  it('finds the instant of clock parts', () => {
    expect(fromZoneParts({ year: 2026, month: 1, day: 15, hour: 15, minute: 0, second: 0 }, istanbul).toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });

  it('round-trips a plain time', () => {
    const parts = { year: 2026, month: 6, day: 10, hour: 9, minute: 30, second: 15 };
    expect(zoneParts(fromZoneParts(parts, newYork), newYork)).toEqual(parts);
  });

  it('resolves both sides of a spring-forward day', () => {
    expect(fromZoneParts({ year: 2026, month: 3, day: 8, hour: 1, minute: 30, second: 0 }, newYork).toISOString()).toBe('2026-03-08T06:30:00.000Z');
    expect(fromZoneParts({ year: 2026, month: 3, day: 8, hour: 3, minute: 30, second: 0 }, newYork).toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('gives a deterministic instant for a clock time the jump skips', () => {
    expect(fromZoneParts({ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 }, newYork).toISOString()).toBe('2026-03-08T06:30:00.000Z');
  });

  it('takes the first of a repeated fall-back clock time', () => {
    expect(fromZoneParts({ year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 }, newYork).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
});

describe('toTemporal', () => {
  it('keeps a day and a moment as they are', () => {
    const d = day('2026-01-31');
    const m = new Date('2026-01-31T09:30:00Z');
    expect(toTemporal(d, istanbul)).toBe(d);
    expect(toTemporal(m, istanbul)).toBe(m);
  });

  it('reads a day text', () => {
    const found = toTemporal('2026-01-31', istanbul);
    expect(found).toBeInstanceOf(Day);
    expect(String(found)).toBe('2026-01-31');
  });

  it('reads an absolute moment text', () => {
    expect(iso(toTemporal('2026-01-31T09:30:00Z', istanbul))).toBe('2026-01-31T09:30:00.000Z');
    expect(iso(toTemporal('2026-01-31T09:30:00+03:00', istanbul))).toBe('2026-01-31T06:30:00.000Z');
    expect(iso(toTemporal('2026-01-31T09:30:00.250-05:00', istanbul))).toBe('2026-01-31T14:30:00.250Z');
  });

  it('reads a zoneless moment text on the clock of the zone', () => {
    expect(iso(toTemporal('2026-01-31 09:30', istanbul))).toBe('2026-01-31T06:30:00.000Z');
    expect(iso(toTemporal('2026-01-31T09:30:15', istanbul))).toBe('2026-01-31T06:30:15.000Z');
    expect(iso(toTemporal('2026-07-01 09:30', newYork))).toBe('2026-07-01T13:30:00.000Z');
  });

  it('gives null for null', () => {
    expect(toTemporal(null, istanbul)).toBeNull();
  });

  it('gives undefined for what it cannot read', () => {
    expect(toTemporal('soon', istanbul)).toBeUndefined();
    expect(toTemporal('2026-02-30', istanbul)).toBeUndefined();
    expect(toTemporal('2026-13-01 10:00', istanbul)).toBeUndefined();
    expect(toTemporal('2026-01-31 24:00', istanbul)).toBeUndefined();
    expect(toTemporal(42, istanbul)).toBeUndefined();
    expect(toTemporal(true, istanbul)).toBeUndefined();
    expect(toTemporal(new Date('wrong'), istanbul)).toBeUndefined();
  });
});

describe('dayOf, instantOf and compareTemporal', () => {
  it('finds the day of a moment in the zone', () => {
    const m = new Date('2026-01-15T22:30:00Z');
    expect(String(dayOf(m, istanbul))).toBe('2026-01-16');
    expect(String(dayOf(m, newYork))).toBe('2026-01-15');
    const d = day('2026-01-15');
    expect(dayOf(d, istanbul)).toBe(d);
  });

  it('finds the start of a day in the zone', () => {
    expect(instantOf(day('2026-03-15'), istanbul).toISOString()).toBe('2026-03-14T21:00:00.000Z');
    const m = new Date('2026-03-15T10:30:00Z');
    expect(instantOf(m, istanbul)).toBe(m);
  });

  it('orders days, moments and one of each', () => {
    expect(compareTemporal(day('2026-03-14'), day('2026-03-15'), istanbul)).toBe(-1);
    expect(compareTemporal(day('2026-03-15'), day('2026-03-15'), istanbul)).toBe(0);
    expect(compareTemporal(new Date('2026-03-15T10:00:00Z'), new Date('2026-03-15T09:00:00Z'), istanbul)).toBe(1);
    expect(compareTemporal(day('2026-03-15'), new Date('2026-03-14T21:00:00Z'), istanbul)).toBe(0);
    expect(compareTemporal(day('2026-03-15'), new Date('2026-03-14T20:59:00Z'), istanbul)).toBe(1);
  });
});

describe('formatDate', () => {
  const saturday = day('2026-01-31');

  it('writes digit tokens', () => {
    expect(formatDate(saturday, 'dd.MM.yyyy', undefined, istanbul)).toBe('31.01.2026');
    expect(formatDate(day('2026-02-05'), 'd.M.yy', undefined, istanbul)).toBe('5.2.26');
  });

  it('writes the clock parts of a day as zero', () => {
    expect(formatDate(saturday, 'HH:mm:ss H', undefined, istanbul)).toBe('00:00:00 0');
  });

  it('writes a moment on the clock of the zone', () => {
    const m = new Date('2026-01-31T22:30:45Z');
    expect(formatDate(m, 'yyyy-MM-dd HH:mm:ss', undefined, istanbul)).toBe('2026-02-01 01:30:45');
    expect(formatDate(m, 'yyyy-MM-dd HH:mm:ss', undefined, newYork)).toBe('2026-01-31 17:30:45');
  });

  it('names months and weekdays in the culture', () => {
    expect(formatDate(saturday, 'dd MMMM yyyy', 'tr-TR', istanbul)).toBe('31 Ocak 2026');
    expect(formatDate(saturday, 'MMM', 'tr-TR', istanbul)).toBe('Oca');
    expect(formatDate(saturday, 'dddd', 'tr-TR', istanbul)).toBe('Cumartesi');
    expect(formatDate(saturday, 'ddd', 'tr-TR', istanbul)).toBe('Cmt');
  });

  it('names months and weekdays plainly without a culture', () => {
    expect(formatDate(saturday, 'MMMM', undefined, istanbul)).toBe('January');
    expect(formatDate(saturday, 'MMM', undefined, istanbul)).toBe('Jan');
    expect(formatDate(saturday, 'dddd', undefined, istanbul)).toBe('Saturday');
    expect(formatDate(saturday, 'ddd', undefined, istanbul)).toBe('Sat');
  });

  it('writes quoted text as it is', () => {
    expect(formatDate(saturday, "'day' dd", undefined, istanbul)).toBe('day 31');
    expect(formatDate(saturday, "H 'o''clock'", undefined, istanbul)).toBe("0 o'clock");
    expect(formatDate(saturday, "dd''MM", undefined, istanbul)).toBe("31'01");
  });

  it('keeps characters that are no token', () => {
    expect(formatDate(saturday, 'dd/MM yyyy!', undefined, istanbul)).toBe('31/01 2026!');
  });
});

describe('formatNumber', () => {
  it('writes grouping and decimals', () => {
    expect(formatNumber(1234.567, '#,##0.00', undefined)).toBe('1,234.57');
    expect(formatNumber(1234567.891, '#,##0.00', undefined)).toBe('1,234,567.89');
    expect(formatNumber(7, '#,##0', undefined)).toBe('7');
    expect(formatNumber(1234.5, '0.00', undefined)).toBe('1234.50');
  });

  it('takes the separators from the culture', () => {
    expect(formatNumber(1234.567, '#,##0.00', 'tr-TR')).toBe('1.234,57');
    expect(formatNumber(0.125, '0.0%', 'tr-TR')).toBe('12,5%');
  });

  it('rounds halves away from zero', () => {
    expect(formatNumber(2.5, '0', undefined)).toBe('3');
    expect(formatNumber(-2.5, '0', undefined)).toBe('-3');
    expect(formatNumber(0.125, '0.00', undefined)).toBe('0.13');
  });

  it('pads required digits', () => {
    expect(formatNumber(5, '0000', undefined)).toBe('0005');
  });

  it('drops optional fraction digits', () => {
    expect(formatNumber(1.5, '#.##', undefined)).toBe('1.5');
    expect(formatNumber(1.5, '0.00#', undefined)).toBe('1.50');
    expect(formatNumber(0, '#.##', undefined)).toBe('0');
  });

  it('writes a percentage', () => {
    expect(formatNumber(0.125, '0.0%', undefined)).toBe('12.5%');
    expect(formatNumber(0.25, '0%', undefined)).toBe('25%');
  });

  it('keeps literal text around the digits', () => {
    expect(formatNumber(12.3, '0.00 TL', undefined)).toBe('12.30 TL');
    expect(formatNumber(12.3, 'total 0.00', undefined)).toBe('total 12.30');
  });

  it('writes no minus for a rounded zero', () => {
    expect(formatNumber(-0.004, '0.00', undefined)).toBe('0.00');
    expect(formatNumber(-1.2, '0.0', undefined)).toBe('-1.2');
  });
});

describe('now and today', () => {
  it('now gives the moment of the context', () => {
    const ctx = context();
    expect(call('now', [], ctx)).toBe(ctx.now);
  });

  it('today gives the day of now in the zone', () => {
    const late = new Date('2026-03-15T22:30:00Z');
    expect(String(call('today', [], context({ now: late })))).toBe('2026-03-16');
    expect(String(call('today', [], context({ now: late, timeZone: newYork })))).toBe('2026-03-15');
  });
});

describe('date and datetime', () => {
  it('builds a day from numbers', () => {
    const found = call('date', [2026, 1, 31]);
    expect(found).toBeInstanceOf(Day);
    expect(String(found)).toBe('2026-01-31');
    expect(String(call('date', [2026]))).toBe('2026-01-01');
    expect(String(call('date', [2026, 1, 32]))).toBe('2026-02-01');
  });

  it('reads a day from a text or a moment', () => {
    expect(String(call('date', ['2026-05-04']))).toBe('2026-05-04');
    expect(String(call('date', [new Date('2026-03-15T20:59:00Z')]))).toBe('2026-03-15');
    expect(String(call('date', [new Date('2026-03-15T21:01:00Z')]))).toBe('2026-03-16');
  });

  it('gives null for a text that is not a day and for null', () => {
    expect(call('date', ['soon'])).toBeNull();
    expect(call('date', [null])).toBeNull();
  });

  it('fails on a value that is no day at all', () => {
    expect(() => call('date', [true])).toThrow('bad value');
  });

  it('reads a moment from a text or the start of a day', () => {
    expect(iso(call('datetime', ['2026-01-31T09:30:00Z']))).toBe('2026-01-31T09:30:00.000Z');
    expect(iso(call('datetime', ['2026-01-31 09:30']))).toBe('2026-01-31T06:30:00.000Z');
    expect(iso(call('datetime', [day('2026-03-15')]))).toBe('2026-03-14T21:00:00.000Z');
    expect(call('datetime', ['soon'])).toBeNull();
    expect(call('datetime', [null])).toBeNull();
  });
});

describe('parts of a day or moment', () => {
  const m = new Date('2026-01-31T22:30:45Z');

  it('reads the parts of a moment in the zone', () => {
    expect(call('year', [m])).toBe(2026);
    expect(call('month', [m])).toBe(2);
    expect(call('day', [m])).toBe(1);
    expect(call('hour', [m])).toBe(1);
    expect(call('minute', [m])).toBe(30);
  });

  it('reads the parts of a day with a clock of zero', () => {
    const d = day('2026-01-31');
    expect(call('year', [d])).toBe(2026);
    expect(call('month', [d])).toBe(1);
    expect(call('day', [d])).toBe(31);
    expect(call('hour', [d])).toBe(0);
    expect(call('minute', [d])).toBe(0);
  });

  it('reads a temporal text too', () => {
    expect(call('year', ['2026-05-04'])).toBe(2026);
  });

  it('gives null for null and fails on what it cannot read', () => {
    expect(call('year', [null])).toBeNull();
    expect(() => call('year', ['bogus'])).toThrow('bad value');
  });

  it('counts weekdays from Monday 1 to Sunday 7', () => {
    expect(call('weekday', [day('2026-03-16')])).toBe(1);
    expect(call('weekday', [day('2026-03-15')])).toBe(7);
    expect(call('weekday', [new Date('2026-03-15T21:30:00Z')])).toBe(1);
  });
});

describe('addDays and addMonths', () => {
  it('moves a day by calendar days', () => {
    const found = call('addDays', [day('2026-01-31'), 1]);
    expect(found).toBeInstanceOf(Day);
    expect(String(found)).toBe('2026-02-01');
    expect(String(call('addDays', [day('2026-03-01'), -1]))).toBe('2026-02-28');
  });

  it('keeps the clock time of a moment across a jump of the zone', () => {
    const ctx = context({ timeZone: newYork });
    expect(iso(call('addDays', [new Date('2026-03-07T14:00:00Z'), 1], ctx))).toBe('2026-03-08T13:00:00.000Z');
    expect(iso(call('addDays', [new Date('2026-10-31T13:00:00Z'), 1], ctx))).toBe('2026-11-01T14:00:00.000Z');
  });

  it('clamps the day of the month', () => {
    expect(String(call('addMonths', [day('2026-01-31'), 1]))).toBe('2026-02-28');
    expect(String(call('addMonths', [day('2024-01-31'), 1]))).toBe('2024-02-29');
    expect(String(call('addMonths', [day('2026-03-31'), -1]))).toBe('2026-02-28');
    expect(String(call('addMonths', [day('2026-11-30'), 3]))).toBe('2027-02-28');
  });

  it('gives the same kind back', () => {
    const found = call('addMonths', [new Date('2026-01-31T09:00:00Z'), 1]);
    expect(found).toBeInstanceOf(Date);
    expect(iso(found)).toBe('2026-02-28T09:00:00.000Z');
  });

  it('gives null when a side is null', () => {
    expect(call('addDays', [null, 5])).toBeNull();
    expect(call('addDays', [day('2026-01-31'), null])).toBeNull();
    expect(call('addMonths', [null, 1])).toBeNull();
  });

  it('fails on a count that is no number', () => {
    expect(() => call('addDays', [day('2026-01-31'), 'x'])).toThrow('bad days');
  });
});

describe('addHours and addMinutes', () => {
  it('adds absolute time to a moment', () => {
    expect(iso(call('addHours', [new Date('2026-03-08T05:30:00Z'), 3], context({ timeZone: newYork })))).toBe('2026-03-08T08:30:00.000Z');
    expect(iso(call('addMinutes', [new Date('2026-03-15T10:30:00Z'), 90]))).toBe('2026-03-15T12:00:00.000Z');
    expect(iso(call('addMinutes', [new Date('2026-03-15T10:30:00Z'), 1.5]))).toBe('2026-03-15T10:31:30.000Z');
  });

  it('starts a day from its first moment in the zone', () => {
    expect(iso(call('addHours', [day('2026-03-15'), 5]))).toBe('2026-03-15T02:00:00.000Z');
    expect(iso(call('addMinutes', [day('2026-03-15'), 30]))).toBe('2026-03-14T21:30:00.000Z');
  });

  it('gives null when a side is null', () => {
    expect(call('addHours', [null, 1])).toBeNull();
    expect(call('addMinutes', [day('2026-03-15'), null])).toBeNull();
  });
});

describe('diffDays and diffMinutes', () => {
  it('counts calendar days from the first to the second', () => {
    expect(call('diffDays', [day('2026-03-01'), day('2026-03-15')])).toBe(14);
    expect(call('diffDays', [day('2026-03-15'), day('2026-03-01')])).toBe(-14);
    expect(call('diffDays', [day('2024-02-28'), day('2024-03-01')])).toBe(2);
  });

  it('counts moments by their days in the zone', () => {
    expect(call('diffDays', [new Date('2026-03-15T20:59:00Z'), new Date('2026-03-15T21:01:00Z')])).toBe(1);
    expect(call('diffDays', [day('2026-03-15'), new Date('2026-03-15T21:01:00Z')])).toBe(1);
  });

  it('counts whole minutes cut toward zero', () => {
    const from = new Date('2026-03-15T10:00:00Z');
    expect(call('diffMinutes', [from, new Date('2026-03-15T11:30:30Z')])).toBe(90);
    expect(call('diffMinutes', [new Date('2026-03-15T11:30:30Z'), from])).toBe(-90);
    expect(call('diffMinutes', [day('2026-03-15'), new Date('2026-03-14T22:00:00Z')])).toBe(60);
  });

  it('counts real minutes across a jump of the zone', () => {
    const ctx = context({ timeZone: newYork });
    expect(call('diffMinutes', [new Date('2026-03-08T05:00:00Z'), new Date('2026-03-08T08:00:00Z')], ctx)).toBe(180);
  });

  it('gives null when a side is null', () => {
    expect(call('diffDays', [null, day('2026-03-15')])).toBeNull();
    expect(call('diffMinutes', [day('2026-03-15'), null])).toBeNull();
  });
});

describe('startOfMonth and endOfMonth', () => {
  it('finds the edges of the month of a day', () => {
    expect(String(call('startOfMonth', [day('2026-02-15')]))).toBe('2026-02-01');
    expect(String(call('endOfMonth', [day('2026-02-15')]))).toBe('2026-02-28');
    expect(String(call('endOfMonth', [day('2024-02-10')]))).toBe('2024-02-29');
    expect(String(call('endOfMonth', [day('2026-01-05')]))).toBe('2026-01-31');
  });

  it('takes the month of a moment in the zone', () => {
    const m = new Date('2026-02-28T22:00:00Z');
    expect(String(call('startOfMonth', [m]))).toBe('2026-03-01');
    expect(String(call('endOfMonth', [m]))).toBe('2026-03-31');
  });

  it('gives null for null', () => {
    expect(call('startOfMonth', [null])).toBeNull();
    expect(call('endOfMonth', [null])).toBeNull();
  });
});

describe('formatDate and format functions', () => {
  it('takes the culture of the context when none is given', () => {
    expect(call('formatDate', [day('2026-01-31'), 'dd MMMM yyyy'])).toBe('31 Ocak 2026');
    expect(call('formatDate', [day('2026-01-31'), 'MMMM'], context({ culture: undefined }))).toBe('January');
  });

  it('takes a culture argument over the context', () => {
    expect(call('formatDate', [day('2026-01-31'), 'MMMM', 'en-US'])).toBe('January');
  });

  it('writes a moment in the zone of the context', () => {
    expect(call('formatDate', [new Date('2026-01-31T22:30:45Z'), 'dd.MM.yyyy HH:mm'])).toBe('01.02.2026 01:30');
  });

  it('gives null for a null day or pattern', () => {
    expect(call('formatDate', [null, 'dd'])).toBeNull();
    expect(call('formatDate', [day('2026-01-31'), null])).toBeNull();
  });

  it('format writes a number with the culture of the context', () => {
    expect(call('format', [1234.5, '#,##0.00'])).toBe('1.234,50');
    expect(call('format', [1234.5, '#,##0.00'], context({ culture: undefined }))).toBe('1,234.50');
    expect(call('format', [0.125, '0.0%', 'en-US'])).toBe('12.5%');
  });

  it('format writes a day or moment with the date pattern', () => {
    expect(call('format', [day('2026-01-31'), 'dd.MM.yyyy'])).toBe('31.01.2026');
    expect(call('format', [new Date('2026-01-31T22:30:45Z'), 'dd.MM.yyyy HH:mm'])).toBe('01.02.2026 01:30');
    expect(call('format', ['2026-01-31', 'dd.MM.yyyy'])).toBe('31.01.2026');
  });

  it('format gives null for null and fails on the rest', () => {
    expect(call('format', [null, '0'])).toBeNull();
    expect(() => call('format', [true, '0'])).toThrow('bad value');
  });
});

describe('the table of functions', () => {
  it('holds each function once, named as the library names them', () => {
    const names = DATE_FUNCTIONS.map((f) => f.name);
    expect(names).toEqual([
      'now', 'today', 'date', 'datetime', 'year', 'month', 'day', 'hour', 'minute', 'weekday',
      'addDays', 'addMonths', 'addHours', 'addMinutes', 'diffDays', 'diffMinutes',
      'startOfMonth', 'endOfMonth', 'formatDate', 'format',
    ]);
  });

  it('tells the reader of each what it is', () => {
    for (const fn of DATE_FUNCTIONS) {
      expect(fn.description.length, fn.name).toBeGreaterThan(10);
      expect(fn.example, fn.name).toContain(fn.name);
      expect(fn.category).toBe(fn.name === 'format' ? 'text' : 'date');
      for (const param of fn.params) expect(param.kinds.length, fn.name).toBeGreaterThan(0);
    }
  });

  it('types the result from the arguments', () => {
    const fn = (name: string) => DATE_FUNCTIONS.find((f) => f.name === name)!;
    expect(fn('addDays').returns([DATE, NUMBER])).toEqual(DATE);
    expect(fn('addDays').returns([DATETIME, NUMBER])).toEqual(DATETIME);
    expect(fn('addDays').returns([ANY, NUMBER])).toEqual(ANY);
    expect(fn('year').returns([DATE])).toEqual(NUMBER);
    expect(fn('formatDate').returns([DATE, TEXT])).toEqual(TEXT);
    expect(fn('date').returns([NUMBER, NUMBER, NUMBER])).toEqual(DATE);
    expect(fn('date').returns([TEXT])).toEqual({ name: 'date', nullable: true });
    expect(fn('datetime').returns([TEXT])).toEqual({ name: 'datetime', nullable: true });
    expect(fn('addHours').returns([DATE, NUMBER])).toEqual(DATETIME);
  });
});
