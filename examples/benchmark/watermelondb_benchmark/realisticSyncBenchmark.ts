import { Database, Model, appSchema, tableSchema } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import { synchronize } from '@nozbe/watermelondb/sync'
import {
  REALISTIC_TABLES,
  runRealisticSyncBenchmark,
  type RealisticDatabase,
  type RealisticSyncOptions,
  type RealisticSyncResult,
  type RealisticSynchronizeFn,
} from '../shared/realisticSyncBenchmark'
import { USE_JSI } from './jsiMode'

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
  const adapter = new SQLiteAdapter({ schema, dbName, jsi: USE_JSI })
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
