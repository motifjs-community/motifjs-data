import type { FieldType } from './field-type';

export interface EvaluateContext {
  fields?: Readonly<Record<string, FieldType>>;
  locale?: string;
  /** Sorting reads the field with this function instead (a computed value). */
  sortValue?: (field: string) => ((row: unknown) => unknown) | undefined;
  /** Filtering reads the field with this function instead (a computed value). */
  filterValue?: (field: string) => ((row: unknown) => unknown) | undefined;
  /** Grouping reads the field with this function instead (a value of its own to group by), also to order the groups. */
  groupValue?: (field: string) => ((row: unknown) => unknown) | undefined;
  /** The groups of a field are ordered with this function instead (of their values); empty values still go last. */
  groupCompare?: (field: string) => ((a: unknown, b: unknown) => number) | undefined;
  /** Summaries read the field with this function instead (a computed value). */
  summaryValue?: (field: string) => ((row: unknown) => unknown) | undefined;
  /** Sorting compares the field's values with this function instead of the type rules; empty values still go last. */
  compare?: (field: string) => ((a: unknown, b: unknown) => number) | undefined;
}
