import type { TableName } from '../../../Schema'
import { localChangeStatuses } from '../../../RawRecord'
import encodeValue from '../encodeValue'
import type { SQL } from '../type'

// SQLite's default SQLITE_MAX_COMPOUND_SELECT is 500
export const TABLES_PER_QUERY = 400

const statuses = localChangeStatuses.map(encodeValue).join(', ')

// One row, the table's name, if the table has at least one record with a local change. EXISTS stops
// at the first match and uses the table's _status index. The column is named `id` because that's
// what queryIds() reads.
const encodeTableCheck = (table: TableName): SQL =>
  `select ${encodeValue(table)} as id where exists (select 1 from "${table}" where "_status" in (${statuses}))`

// Queries that together return the names of the `tables` with local changes: one compound select
// per TABLES_PER_QUERY tables. The SQL only depends on the table list, so it stays in the native
// statement cache.
export default function encodeLocalChangesQueries(tables: TableName[]): SQL[] {
  const queries: SQL[] = []
  for (let i = 0; i < tables.length; i += TABLES_PER_QUERY) {
    queries.push(
      tables
        .slice(i, i + TABLES_PER_QUERY)
        .map(encodeTableCheck)
        .join(' union all '),
    )
  }
  return queries
}
