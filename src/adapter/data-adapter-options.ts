import type { FieldType } from '../query/field-type';
import type { Capabilities } from './capabilities';
import type { KeyExpr } from './key-expr';

export interface DataAdapterOptions<T> {
  key?: KeyExpr<T>;
  fields?: Readonly<Record<string, FieldType>>;
  /** Used to compare text in memory (Turkish İ/ı). */
  locale?: string;
  /** Turns off what an endpoint cannot do; that part then runs in memory. */
  capabilities?: Partial<Capabilities>;
  /** Sorting in memory reads the field with this function instead (a computed value); `undefined` for the field's own value. */
  sortValue?: (field: string) => ((row: T) => unknown) | undefined;
  /** Filtering in memory reads the field with this function instead (a computed value); `undefined` for the field's own value. */
  filterValue?: (field: string) => ((row: T) => unknown) | undefined;
  /** Sorting in memory compares the field's values with this function instead of the type rules; empty values still go last. */
  compare?: (field: string) => ((a: unknown, b: unknown) => number) | undefined;
}
