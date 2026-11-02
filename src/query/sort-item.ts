export interface SortItem {
  /** Dotted paths read nested values: `'customer.name'`. */
  field: string;
  dir: 'asc' | 'desc';
}
