const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * A day of the calendar, with no time and no time zone: the value of the `date` type. A moment (`datetime`) is a
 * `Date`. It is written as `YYYY-MM-DD`, in JSON too.
 */
export class Day {
  readonly year: number;
  readonly month: number;
  readonly day: number;

  constructor(year: number, month: number, day: number) {
    // Out of range parts move on, as a calendar does: the 32nd of January is the 1st of February.
    const d = new Date(Date.UTC(year, month - 1, day));
    d.setUTCFullYear(year, month - 1, day);
    this.year = d.getUTCFullYear();
    this.month = d.getUTCMonth() + 1;
    this.day = d.getUTCDate();
  }

  /** A day written as `YYYY-MM-DD`; `null` for a text that is not one, or a day the calendar has not (`2026-02-30`). */
  static parse(text: string): Day | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!m) return null;
    const day = new Day(Number(m[1]), Number(m[2]), Number(m[3]));
    return day.toString() === text ? day : null;
  }

  /** The days since 1970-01-01, for counting and comparing. */
  get serial(): number {
    return Date.UTC(this.year, this.month - 1, this.day) / 86_400_000;
  }

  /** The day of the week: Monday 1 to Sunday 7. */
  get weekday(): number {
    return ((new Date(Date.UTC(this.year, this.month - 1, this.day)).getUTCDay() + 6) % 7) + 1;
  }

  addDays(n: number): Day {
    return new Day(this.year, this.month, this.day + n);
  }

  toString(): string {
    return `${pad(this.year, 4)}-${pad(this.month)}-${pad(this.day)}`;
  }

  toJSON(): string {
    return this.toString();
  }
}
