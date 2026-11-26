# Changelog

All notable changes to this package are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0-beta.3] - 2026-11-26

### Added

- `expression`: a small expression language for the conditions, values and texts an application computes from data,
  the same in a page and on a server. `parse` reads an expression into its tree (plain JSON, `version: 1`, every node
  with its place in the text) and `parseTemplate` a text with `{{ … }}` expressions in it; `check` gives the type of the
  value and the problems against a schema of names and their types (`Schema`, `type`, `typeText`, `nullable`,
  `joinTypes`; `expect` for the type the value is wanted as) and never throws; `evaluate` computes a tree with the
  values of its names, and `run` and `render` read and compute an expression or a template at once. A value is a
  number, a text, a boolean, a day (`Day`), a moment, a list, an object or `null`, and nothing is converted implicitly;
  `?.` and `??` handle values that may be missing, and a short function is passed as an argument
  (`filter(rows, r => r.total > 100)`).
- `expression.functions`: 84 functions on texts, numbers, lists, objects, logic, days and moments; `if` and `coalesce`
  evaluate only the arguments they need. The `functions` option adds an application's own, checked and described as
  the library's are. `timeZone`, `culture` and `now` set the clock and the culture an expression is evaluated in, and
  `formatDate` and `format` write days, moments and numbers by a pattern.
- The problems of an expression carry a code, a place (`at: [start, end]`) and their parameters (`Problem`,
  `ProblemCode`, `PROBLEM_TEXTS`, `problemText`). `check` returns them as values, `mayBeNull` as a warning and the
  others as errors; reading stops at the first problem, and `evaluate`, `run` and `render` throw it as an
  `ExpressionError`. `limits` (`DEFAULT_LIMITS`: steps, list and text lengths, depth) keeps an expression from running
  away.
- For an editor of expressions: `tokens` gives the pieces of a text with their kinds, `complete` the words that may be
  written at an offset (the fields of the value before a dot, the names of the schema, the parameters of the short
  functions around it, the functions and the words of the language), and `signatureAt` the call and the argument the
  offset is in.
- `jsonSchema`: values validated against a schema in a subset of JSON Schema (`JsonSchema`: `type`, `enum`, `const`, the
  bounds of numbers and texts, `pattern`, `format` (`date`, `date-time`, `email`, `uri`), `properties`, `required` and
  `items`; a key that starts with `x-` belongs to the application). `validate` tells whether a value fits and gives each
  problem with its path (`SchemaProblem`, `SCHEMA_PROBLEM_TEXTS`, `schemaProblemText`); `check` lists the keys of a
  schema that are not read or not valid, so that no rule is dropped silently; `defaults` gives the value a schema starts
  with. `matchesFormat`, `typeOfValue` and `sameValue` are the parts they are built on.
- `loadPivotBlocks` on every adapter and on `DataSource` (`PivotBlocksOptions`, `PivotBlocksResult`; in memory
  `pivotBlocks`, and `readPivotBlocks` for a backend's answer) counts the members below the children of members, a block
  of children at a time in the order `loadPivotMembers` gives them, and `descendants` of `loadPivotMembers` counts them
  for each member of a part: a view places members open by default without reading every one. A backend says it
  computes them with `capabilities.pivotBlocks`; one that does not works on as it was. REST: `pivot: { blocks: true }`
  (`kind: 'blocks'`). OData: wherever it computes parts, two reads a parent and level, keys and counts alone.
- `SoapAdapter`: a `pivot` operation computes pivots, whole and in parts, with the bodies and answers of a REST pivot
  endpoint as JSON text (`window`, `blocks`, `args`, `read`); without it they are grouped in memory as before.
- `ODataAdapter`: `aggregation: { pageSize }` asks for the `$apply` reads of every group in an order in pages.
- `ODataAdapter`: `aggregation: { conditional: true }` says the service takes `case` in `compute` (OData 4.01). Pivot
  members ordered by a measure in a member of the other axis (`sortBySummary` with `path`) are then counted and paged
  on the service like the other orders — the measure fed only that member's rows through computed values, members
  without a row in it last — instead of every member of the parent being read and ordered in memory, which stays the
  way without the option.

### Changed

- `ODataAdapter` follows the pages (`@odata.nextLink`) a service cuts an answer to `$apply` into: the groups past the
  first page were missing.
- Pivot cells over rows in memory (`pivotCells`, `pivotCellGroups`) find a row's crossings by their numbers instead of a
  text made for each row, and a level's members are ordered with each one's comparable value worked out once, not
  twice for every comparison: the cells of a million rows about a third faster, 100,000 members ordered about a sixth
  faster, the same answers.
- `pivotMembers` and `pivotBlocks` over rows in memory find the children asked for in one pass over the rows, each row
  added to nothing but them, where they grouped the rows on every level above as well: 12,500 customers of 125,000 rows
  with the number of members below each in about half the time, the years of 5,000 customers in about a third. A slice's
  parent, and each member to `find`, is looked up by its key instead of searched for among its siblings. The same answers.

## [0.1.0-beta.2] - 2026-11-22

### Added

- Pivots: `loadPivot(options)` on every adapter and on `DataSource` (over its query) groups the rows by
  `rows` levels and `columns` levels at once and gives the `measures` of every crossing and every total.
  The result holds the two axes as member trees (`key`, `path`, `count`, `children`) and
  `values(row, column)`. Only the children of `expandedRows` and `expandedColumns` are computed. A
  level groups dates by `'year'`, `'quarter'`, `'month'`, `'day'`, `'dayOfWeek'` or `'date'`, and
  numbers by ranges of a width. Totals come from their rows (the average of a total is that of its
  rows). Levels and measures can read computed values, and `{ type: 'custom', start, add, result }`
  is a measure of your own. In memory (`queryPivot`, `pivotGroups`, `pivotResult`) 100,000 rows on two
  levels each way with three measures took about 110 ms in Node on a desktop machine.
- `capabilities.pivot`: a backend that computes pivots is asked for the groups (`PivotGroup`).
  `ODataAdapter` with `aggregation` sends one `$apply` `groupby` per pair of depths;
  `aggregation: { batch: true }` sends them in one `$batch`, and `aggregation: { compute: true }`
  computes intervals with `compute`. `RestAdapter` with `pivot: { url }` posts the options as JSON
  (`defaultPivotBody`) and reads the groups (`defaultReadPivot`). A pivot that needs memory (a
  computed value, a custom measure, an interval the service cannot compute) loads the rows and groups
  them in memory.
- `countDistinct` summaries: the different values that are not empty, compared the way filters compare
  them; on OData with `aggregation`, `countdistinct`.
- Pivots keep rows by their members (`keep`): a field read through intervals of its own (date parts, ranges of
  numbers) or a computed value, the paths of the members kept or left out, `null` for empty values, the field on
  an axis or not. OData filters with its date functions, without `compute`; REST gets `keep` in the body; a keep by
  the day of the week or by a computed value runs in memory. A keep's `filter` counts the rows it passes as members
  too, kept or left out with them (OData joins it with `or`).
- Pivots in parts, for a view that loads as it scrolls and never the whole result: `loadPivotMembers` (a part of each
  slice's parent's children, in their order or by a measure at the other axis's total or in one of its members, with
  the number of all of them and of their children, and the places of members among them with `find`),
  `loadPivotCounts` (the number of children of members) and
  `loadPivotCells` (the measures of the row and column members asked for, totals included), on every adapter and on
  `DataSource`. `capabilities.pivotWindow` says the backend computes them: OData with `aggregation` (paged with
  `$orderby`, `$skip`, `$top` and `$count`; the empty member apart; ordered by a measure in two rounds, the groups its
  value tells apart counted and then paged; a long list of members split into several reads; all in one `$batch` with
  `aggregation.batch`), and REST with `pivot` (a body with `kind`, `defaultPivotPartBody`, `window: false` for an
  endpoint of whole pivots only). Otherwise the rows are grouped in memory (`pivotMembers`, `pivotCounts`,
  `pivotCells`), in the same order and with the same values as `queryPivot`. Over a million rows in Node on a desktop
  machine, the top members with the number of their children took about 0.7 s, a part of 100 of a member's 12,500
  children about 0.25 s, and the values of 100 members by 2 about 0.1 s.
- Running totals with the cells of a pivot: `loadPivotCells` takes `running` (`PivotRunningTotal`: a measure added up
  over a member's siblings on an axis, up to the member, in the order `loadPivotMembers` gives them, by a measure with
  `orders`), and its result gives `running(rowPath, columnPath)`. Memory computes them; REST writes `running` in the
  body and takes `running` from the groups of the answer; where a backend gives none (OData, an endpoint that does not
  know them), the adapter reads each parent's children in their order and their values, and adds them up.
  `pivotCellGroups(rows, body)` answers a cells request as a server does: the groups with their running totals, those
  no row falls in among them (`count` 0).
- Conditions through an interval: a filter condition's `interval` (`where('date', '=', 2024, { interval: 'year' })`)
  compares the value the interval reads, as a pivot level groups it: a part of a date or the start of a range of
  numbers; a value it cannot read is blank. Memory reads it as pivots do, OData writes `year()`, `month()`, `day()`,
  `date()`, the quarter and the range, REST sends it in the filter. `canFilter(filter)` tells whether a backend applies a
  filter: OData has no function for the day of the week.
- `DataSource.narrow(filter, options)`: a new data source over the same adapter, for the rows of the current query
  (filter and search, params, select, expand) that the filter keeps too.
- Rows given anew: `ArrayAdapter.setData(rows)` and its `data`, read and written, replace its array (or the function
  read on every operation), and `onChanged` tells it with `source: 'replace'`. Every `DataSource` over the adapter
  forgets the rows found by key and loads again from the first page; `DataSource.setData(rows)` does it through its
  own adapter and resolves once the rows are loaded, and throws `MJD302` over an adapter whose rows are its backend's.
- Grouping in memory reads a date's part and a text's comparable form once per value, not once per row, finds a
  row's member by the row's value before working out how it compares, and orders members by forms worked out once;
  numbers of children are counted without grouping the children. A level of values all different keeps up to 262,144
  of them worked out.
- Pivot parts without empty members: `nonEmpty` on `loadPivotMembers` and `loadPivotCounts` leaves out the members
  whose measures are all empty (`allEmpty`: every value `null`, `undefined`, `''` or `NaN`), of the members, their
  number, their children's numbers and the places `find` gives, so the lines a view counts stay right. A `count`,
  `countDistinct` or `sum` always has a value, so with one of them nothing is left out. `loadPivotCounts` takes
  `measures` for it. Memory computes it, OData filters the groups on their measures after `aggregate`, REST writes
  `nonEmpty` (and the counts' `measures`) in the body.
- The demo has a Pivot tab: 100,000 orders by city and customer down, quarter and month across, with
  four measures, members that open and close and a filter; and TripPin's people counted with `$apply`, in
  one `$batch` or not, checked against the memory engine. In Chrome on a desktop machine the first pivot
  of the orders took about 240 ms and later ones about 120 ms.

### Fixed

- The demo page says it has no icon, so the browser no longer asks for `/favicon.ico` and logs a 404.

## [0.1.0-beta.1] - 2026-11-14

### Added

- Fields that hold a list of values (arrays): a filter condition passes when one of the values does;
  with `<>`, `notin` and `notcontains`, when none does. A list with no value that is not blank is
  blank (`isblank`, `= null`), an empty list too. `ODataAdapter` writes these conditions with `any()`
  for the fields named in its new `collections` option (`toODataFilter` takes it too); REST and SOAP
  send the condition as it is.

## [0.1.0-beta.0] - 2026-10-30

The first preview on npm (`npm i @motifx-community/data@beta`).

### Added

- Blocks without a count (an endless list over a backend that cannot count): `count: false` now
  holds in `'blocks'` too, so no block asks for the total (a backend without a count would otherwise
  load every row to count them). A block that comes back shorter than the block size tells where the
  rows end (`total`), an empty block right after a full one too. A block that fails after the first
  one counts in `failedBlocks` and leaves the source ready, with a count or without.
- `DataSource.setPageSize(size)`: another page size for a source that loads by page (0: one page
  with every row); the rows it holds go and the first page loads. `pageSize` is a getter now. The
  size of a block stays fixed (`'blocks'` throws `MJD302`).
- `data.isFilterExpression(value)`: whether a value is a filter expression (a condition with a known
  operator, or `and` / `or` / `not` of them), without throwing.

- `ChangeTracker.removeRows(rows)` and `removeKeys(keys)`: several deletions in one save. `'batch'`
  marks them; `'wait'` and `'background'` send them together through the adapter's `save` (one
  request with OData `$batch`, a REST batch endpoint or a SOAP `save` operation, else one request per
  row). New rows among them are dropped. `remove(row)` is `removeRows([row])`.
- Summaries on demand: `DataSource.loadSummary(items)` gives summary values of the current query
  (filter, search, params) over every matching row from the adapter, without touching the rows the
  source holds; `loadGroups(group, { groupSummary })` asks for other group summaries than the
  source's own. `SummaryItem.skipEmpty` (default `true`; `false` counts empty values as 0 in `sum` and
  `avg`) and `summaryValue` in the evaluate context (memory reads a field's summary value with a
  function, a computed column).
- Every behaviour of the layer is an option, its default today's value: `DataSource` `jumpRows`
  (default `pageSize`: a move of more rows waits for `scrollStopMs`) and `nearBlocks` (default 1:
  blocks kept loading and cached around the view); `ChangeTracker` `saveOrder` (default
  `['remove', 'update', 'insert']`) and `sameValue(a, b, field)` (what counts as no change);
  `HttpAdapter` `readError(response)` (the backend's own error format, without a subclass; SOAP faults
  too) and `errorTextLength` (default 300).
- `ChangeTracker.onSaving` (cancelable: change a change's `data`, `skip(row)` keeps one row back,
  `cancel` keeps all; a row kept back in `'wait'` makes `commit` resolve `false`) and `onSaved`
  (`changes`, `rows`, `outcomes`). `ChangeTracker.pendingRows()`: the rows with something to save.

- Grouping without the rows: `groupsOnly` load option (the groups with their keys, counts and
  group summaries; `rows` empty, and a backend that sends the rows anyway has them dropped) and
  `DataSource.loadGroups(group)` for the current query. `groupValue` in the evaluate context (and
  `groupContext`): memory groups a field by a value of its own and orders the groups by it;
  `groupCompare` orders a field's groups with a function.
  `LoadRangeOptions.sort`: a range in another order. `DataSource.ensureRanges(ranges)`: blocks for
  several runs of rows at once (a list with closed groups between them).
- `none()`: a filter no row passes (`{ or: [] }`); in memory it keeps nothing, OData writes `false`,
  and inside `and` / `or` it works as `false`.
- `sortValue` and `compare` adapter options: per field, the value memory sorts by and the order it
  sorts in (`ArrayAdapter` and the memory step of every adapter); `DataAdapter.evaluateContext` is public.
- `DataSource.loadRange({ skip, take, filter, count, signal })`: a part of the current query without
  touching the loaded rows (export, print); rejects on failure.
- `filterValue` adapter option: per field, the value memory filters by (a computed value), in
  `ArrayAdapter`, the memory step of every adapter and the filters `DataSource` runs in memory.
- `ChangeTracker.editOf(row)` / `editById(id)`: what is held for a row, to read (`RowEditState`:
  `isNew`, `removed`, `saving`, `failed`, `draft`, `errors`).
- `ChangeTracker` `keepSavedNewRows`: saved new rows stay in `newRows` until the source's `reload()`.
- `DataSource.loadedPageIndex`; `DataSource` `keepRowsWhileLoading` (`'all'`, default `true`);
  `onChanged` reasons `query` and `reload`.
- `DataAdapter`: `load`, `count`, `byKey`, `insert`, `update`, `remove`, `save` (one outcome per change),
  `push`; backend capabilities with the rest done in memory; core events (`onLoading` … `onError`,
  cancellable "before" events); single, composite and function keys.
- `ArrayAdapter`: rows in an array, written in place.
- `HttpAdapter`: one `send` for every request with `fetch`, `headers`, `beforeSend`, `afterReceive`,
  `onRequesting`, `onResponded`, `timeoutMs`, `retry` / `resilience` (core `Resilience`), error
  statuses read into codes.
- `RestAdapter`: REST endpoints with changeable addresses, methods, query and answer mapping, batch.
- `ODataAdapter` (v4): `$filter` with the in-memory meaning, `$orderby`, `$skip`/`$top`, `$count`,
  `$select`, nested `$expand`, `@odata.nextLink` paging, key literals (single, composite, GUID),
  `If-Match` from `@odata.etag`, `$batch` (multipart, optional change set). `toODataFilter`, `odataLiteral`.
- `SoapAdapter` (WCF and other SOAP services): operations mapped to the contract, `handles` for what
  the load operation does itself, DataContract writing (namespace, alphabetical order, `firstFields`,
  `lists`) or XmlSerializer writing, SOAP 1.1 / 1.2, WS-Addressing, `soapHeader`, faults to `MJD202` /
  `MJD201` or `readFault`, declared `number` / `boolean` fields converted.
- `DataSource`: rows for a component through any adapter, `loadMode` `'all'`, `'page'` or `'blocks'`
  (virtual: blocks where the view is, wait after a jump, abort left behind, block cache, pin), filter,
  sort, search over `searchFields`, `byKey` with lookups kept, adapter changes applied to loaded rows,
  `onChanged`.
- Groups and summaries: `group`, `groupSummary`, `summary` in `LoadOptions`; `groups`, `groupCount`,
  `summary` in `LoadResult`; `group` / `summary` capabilities (in memory when the backend lacks them);
  `groupRows`, `summarize`. `DataSource` groups in `'all'` and `'page'` and loads summaries once per query.
  `ODataAdapter` `aggregation` computes summaries with `$apply`; reads go without OData version headers.
- `DataSource` `'page'`: when the adapter cannot do all of the query, the matching rows load once per row
  set and are kept; summaries, groups, sorting and page turns come from them without a request, and
  saved changes go into them. Groups and summaries follow a filter made in memory.
- The demo: one tab per use against real services (memory, Northwind, lookup, virtual list, DummyJSON,
  editing TripPin with etags, local WCF); `npm run wcf` starts the WCF service.
- `ChangeTracker`: edits by row key over a `DataSource`, new rows, deletion marks, field and row checks,
  save modes `wait` / `background` / `batch`, messages from failed saves by field, `onChanged`.
- `save` sends a single change alone, without `saveBatch`.
- `original` (the row as it was read) in `update`, `remove` and `Change`; `MJD305` for a 428 answer.
- `npm run test:live`: the adapters against public demo services.
- The whole API is one namespace, `data` (`import { data } from '@motifx-community/data'`); the UMD build
  (`dist/index.umd.js`) for a script tag puts it at `motif.data`, next to the core's `motif`.
- `DataError` (a `MotifError`) with `MJD` codes.
- Filter model (`where`, `and`, `or`, `not`), `createRowFilter`, `sortRows`, `queryArray` on core `Query`.

### Changed

- `validateField(field, value, { row, isNew })`: the third argument is a context, like `validateRow`'s.
- `DataSource` `'all'`: a new query keeps the old rows until the new ones arrive and fires `query`, not
  `cleared`. Saved new rows leave `ChangeTracker.newRows` on `query`.
- The given objects are kept as they are, plain or reactive. `ArrayAdapter.insert(row)` and a pushed
  insert store that very object (no copy), and `insert` resolves to it; a key from `createKey` is
  written onto it, and only once the key is known to be free. `onInserting` gets the given object as
  `values` and `onUpdating` the given changes. When a backend sends back only some fields (a new id, an
  etag), they are written onto the given object and `insert` resolves to it; a whole saved row from the
  backend is still the backend's own object. An update without an answer resolves to the given changes.
- `ChangeTracker`: `original` of an update or a deletion is the row itself, not a copy of it.
- `ChangeTracker` saves a new row as itself: the entered values are written onto the row in `newRows`
  and that object is sent, so an `ArrayAdapter` stores the tracker's row (`onSaving` still gets the
  values to save in `changes[i].data` and may change them). A new row whose save failed is no longer
  dropped as untouched.
- `validateField(field, value, { row, values, isNew, getValue })` and
  `validateRow(row, { values, isNew, changed, getValue })` get the row itself, not a copy with the
  entered values on it. `values` holds the entered values, `getValue(field)` the value a field is
  saved with (type `RowCheckContext`).

### Fixed

- `DataSource` `'page'`: while another page loads, `rowAt` no longer gives the old page's rows at the
  new page's indexes.
- `DataSource` `'blocks'`: `status` is `'loading'` after a new query or `reload()` until the first block
  arrives, and `'error'` when that block fails; `reload()` of an empty result asks the adapter again.
