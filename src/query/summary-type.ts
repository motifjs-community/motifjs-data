/**
 * `count` counts rows; `countDistinct` counts the different values that are not empty, compared the way filters compare
 * them (text without case in the locale, `date` fields by day); `sum` and `avg` read numbers; `min` and `max` follow the
 * field's order (numbers, dates, text).
 */
export type SummaryType = 'count' | 'countDistinct' | 'sum' | 'min' | 'max' | 'avg';
