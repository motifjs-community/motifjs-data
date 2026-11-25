/** What a service does of OData Data Aggregation besides `aggregate` and `groupby`. */
export interface ODataAggregationOptions {
  /**
   * The service takes `compute`: pivot levels with an interval are computed there (`year()`, `month()`, `day()`, `date()`,
   * `floor()`), by the service's clock. `'dayOfWeek'` has no OData function and is grouped in memory either way.
   * Default `false`: a pivot with an interval is grouped in memory.
   */
  compute?: boolean;
  /**
   * The service takes `case` in `compute` (OData 4.01): pivot members ordered by a measure in a member of the other
   * axis (`sortBySummary` with `path`) are counted and paged there, like the other orders; levels with an interval
   * need `compute` too. Default `false`: every member of the parent is read and ordered in memory.
   */
  conditional?: boolean;
  /**
   * The rows one answer to `$apply` may hold: a read of every group in an order (the members of a level read whole, the
   * counts that place members open by default) is asked for in pages of it, with `$skip` and `$top`. Give it what the
   * service takes as `$top`. Default none: such a read is one request, the pages the service itself cuts it into followed.
   */
  pageSize?: number;
  /**
   * A pivot sends its requests (one per pair of depths of its axes) in one `$batch` request, to the `batch` option's
   * `url` when it gives one. Default `false`: one request each, all at once.
   */
  batch?: boolean;
}
