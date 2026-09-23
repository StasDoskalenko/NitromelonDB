import { Database, Model, appSchema, tableSchema } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import { synchronize } from '@nozbe/watermelondb/sync'
import {
  runSyncBenchmark,
  SYNC_COLUMNS,
  SYNC_TABLE,
  type SyncBenchmarkOptions,
  type SyncBenchmarkResult,
  type SyncDatabase,
  type SynchronizeFn,
} from '../shared/syncBenchmark'

// Its own database, separate from the main write/query/delete harness. See
// ../shared/syncBenchmark.ts for the workload.

class SyncItem extends Model {
  static table = SYNC_TABLE
}

const schema = appSchema({
  version: 1,
  tables: [tableSchema({ name: SYNC_TABLE, columns: SYNC_COLUMNS.map((column) => ({ ...column })) })],
})

function openDatabase(): Promise<SyncDatabase> {
  const adapter = new SQLiteAdapter({ schema, dbName: 'watermelon-sync', jsi: true })
  const database = new Database({ adapter, modelClasses: [SyncItem] })
  return Promise.resolve(database as unknown as SyncDatabase)
}

export function runSync(options: SyncBenchmarkOptions): Promise<SyncBenchmarkResult> {
  return runSyncBenchmark(openDatabase, synchronize as unknown as SynchronizeFn, options)
}
