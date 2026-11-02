/** What a backend does itself; anything turned off here is done in memory. */
export interface Capabilities {
  filter: boolean;
  sort: boolean;
  paging: boolean;
  count: boolean;
  select: boolean;
  group: boolean;
  summary: boolean;
  insert: boolean;
  update: boolean;
  remove: boolean;
}
