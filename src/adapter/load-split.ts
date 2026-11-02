import type { LoadOptions } from '../query/load-options';
import type { Capabilities } from './capabilities';

/** What the backend is asked for, and what is done in memory afterwards on the rows it returns. */
export interface LoadSplit {
  remote: LoadOptions;
  local: LoadOptions;
}

// Filtering, sorting, grouping or summing in memory needs every matching row, so paging and counting
// move to memory with them.
export function splitLoad(o: LoadOptions, caps: Capabilities): LoadSplit {
  const sort = o.sort ?? [];
  const grouped = !!o.group?.length;
  const summed = !!o.summary?.length;
  const localFilter = !!o.filter && !caps.filter;
  const localSort = sort.length > 0 && !caps.sort;
  // Grouping and summaries go together: if one is done in memory, both are. A filter done in memory
  // takes them along, or they would count rows it drops.
  const localAggregate = (grouped || summed) && (localFilter || (grouped && !caps.group) || (summed && !caps.summary));
  const needsAll = localFilter || localSort || localAggregate;
  const paged = (o.skip ?? 0) > 0 || o.take !== undefined;
  const localPaging = paged && (needsAll || !caps.paging || (!!o.count && !caps.count));
  const localCount = !!o.count && (localFilter || localPaging || localAggregate || !caps.count);
  // Work done in memory may need fields a remote selection would drop.
  const remoteSelect = o.select?.length && caps.select && !needsAll ? o.select : undefined;

  const remote: LoadOptions = {};
  if (o.filter && !localFilter) remote.filter = o.filter;
  if (sort.length && !localSort && !localAggregate) remote.sort = sort;
  if (paged && !localPaging) {
    if (o.skip !== undefined) remote.skip = o.skip;
    if (o.take !== undefined) remote.take = o.take;
  }
  if (o.count && !localCount) remote.count = true;
  if (remoteSelect) remote.select = remoteSelect;
  if (o.expand) remote.expand = o.expand;
  if (!localAggregate) {
    if (grouped) remote.group = o.group;
    if (grouped && o.groupsOnly) remote.groupsOnly = true;
    if (grouped && o.groupSummary?.length) remote.groupSummary = o.groupSummary;
    if (summed) remote.summary = o.summary;
  }
  if (o.params) remote.params = o.params;
  if (o.signal) remote.signal = o.signal;

  const local: LoadOptions = {};
  if (localFilter) local.filter = o.filter;
  if (sort.length && (localSort || localAggregate)) local.sort = sort;
  if (localPaging) {
    if (o.skip !== undefined) local.skip = o.skip;
    if (o.take !== undefined) local.take = o.take;
  }
  if (localCount) local.count = true;
  if (o.select?.length && !remoteSelect) local.select = o.select;
  if (localAggregate) {
    if (grouped) local.group = o.group;
    if (grouped && o.groupsOnly) local.groupsOnly = true;
    if (grouped && o.groupSummary?.length) local.groupSummary = o.groupSummary;
    if (summed) local.summary = o.summary;
  }
  return { remote, local };
}
