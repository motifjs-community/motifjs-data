/** What a service does of OData Data Aggregation besides `aggregate` and `groupby`. */
export interface ODataAggregationOptions {
  /**
   * The service takes `compute`: pivot levels with an interval are computed there (`year()`, `month()`, `day()`, `date()`,
   * `floor()`), by the service's clock. `'dayOfWeek'` has no OData function and is grouped in memory either way.
   * Default `false`: a pivot with an interval is grouped in memory.
   */
  compute?: boolean;
  /**
   * A pivot sends its requests (one per pair of depths of its axes) in one `$batch` request, to the `batch` option's
   * `url` when it gives one. Default `false`: one request each, all at once.
   */
  batch?: boolean;
}
