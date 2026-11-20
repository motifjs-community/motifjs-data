/**
 * How a pivot level groups a field's values. Date parts read the date in local time: `'year'` (2024), `'quarter'`
 * (1–4), `'month'` (1–12), `'day'` (day of the month, 1–31), `'dayOfWeek'` (0 Sunday – 6 Saturday), `'date'` (the
 * calendar day, a `Date` at local midnight). A number groups numbers in ranges of that width, each named by its start
 * (with 100: 0, 100, 200 …; a value on a boundary starts the next range).
 */
export type PivotInterval = 'year' | 'quarter' | 'month' | 'day' | 'dayOfWeek' | 'date' | number;
