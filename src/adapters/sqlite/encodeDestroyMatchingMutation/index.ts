import type { TableName } from '../../../Schema'
import type { SQL } from '../type'

// Shared by the sqlite-node and sqlite-wasm DatabaseDriver#destroyMatching() implementations
// (the native/shared C++ path mirrors the same logic in its own language, see
// native/shared/Database-batch.cpp's Database::destroyMatching).
//
// `sql` is the exact same query that would otherwise power queryIds() for this table. When
// there's a predicate at all, it's reused as an inline derived table (`where "id" in (select
// "id" from (<sql>))`), so no `WHERE id IN (?,?,...)` argument list ever needs to be built. When
// there's no predicate (isUnconditional), skips straight to a bare delete/update instead, so
// SQLite can take its own optimized path for an unconditional DELETE.
export default function encodeDestroyMatchingMutation(
  table: TableName,
  sql: SQL,
  permanently: boolean,
  isUnconditional: boolean,
): SQL {
  if (isUnconditional) {
    return permanently ? `delete from "${table}"` : `update "${table}" set "_status" = 'deleted'`
  }
  return permanently
    ? `delete from "${table}" where "id" in (select "id" from (${sql}))`
    : `update "${table}" set "_status" = 'deleted' where "id" in (select "id" from (${sql}))`
}
