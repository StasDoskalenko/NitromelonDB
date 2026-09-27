import { Database, Model, appSchema, tableSchema } from 'nitromelondb'
import SQLiteAdapter from 'nitromelondb/adapters/sqlite'
import { synchronize } from 'nitromelondb/sync'
import {
  REALISTIC_TABLES,
  runRealisticSyncBenchmark,
  type RealisticDatabase,
  type RealisticSyncOptions,
  type RealisticSyncResult,
  type RealisticSynchronizeFn,
} from '../shared/realisticSyncBenchmark'

// See ../shared/realisticSyncBenchmark.ts and ../mock-server for the workload.

const modelClasses = REALISTIC_TABLES.map(
  ({ name }) =>
    class extends Model {
      static table = name
    },
)

const schema = appSchema({
  version: 1,
  tables: REALISTIC_TABLES.map(({ name, columns }) =>
    tableSchema({ name, columns: columns.map((column) => ({ ...column })) }),
  ),
})

function openDatabase(dbName: string): Promise<RealisticDatabase> {
  const adapter = new SQLiteAdapter({ schema, dbName })
  const database = new Database({ adapter, modelClasses })
  return Promise.resolve(database as unknown as RealisticDatabase)
}

export function runRealisticSync(options: RealisticSyncOptions): Promise<RealisticSyncResult> {
  return runRealisticSyncBenchmark(
    openDatabase,
    synchronize as unknown as RealisticSynchronizeFn,
    options,
  )
}
