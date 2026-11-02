# Changelog

All notable changes to this package are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
