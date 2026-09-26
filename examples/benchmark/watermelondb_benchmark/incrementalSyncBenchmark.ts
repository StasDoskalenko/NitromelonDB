import { Database, Model, Q, appSchema, tableSchema } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import { synchronize } from '@nozbe/watermelondb/sync'
import {
  INCREMENTAL_COLUMNS,
  INCREMENTAL_TABLES,
  runIncrementalSyncBenchmark,
  type IncrementalDatabase,
  type IncrementalSyncOptions,
  type IncrementalSyncResult,
  type IncrementalSynchronizeFn,
} from '../shared/incrementalSyncBenchmark'
import { USE_JSI } from './jsiMode'

// Its own database file. See ../shared/incrementalSyncBenchmark.ts for the workload.

const modelClasses = INCREMENTAL_TABLES.map(
  (table) =>
    class extends Model {
      static table = table
    },
)

const schema = appSchema({
  version: 1,
  tables: INCREMENTAL_TABLES.map((name) =>
    tableSchema({ name, columns: INCREMENTAL_COLUMNS.map((column) => ({ ...column })) }),
  ),
})

function openDatabase(): Promise<IncrementalDatabase> {
  const adapter = new SQLiteAdapter({ schema, dbName: 'watermelon-incr', jsi: USE_JSI })
  const database = new Database({ adapter, modelClasses })
  return Promise.resolve(database as unknown as IncrementalDatabase)
}

export function runIncrementalSync(
  options: IncrementalSyncOptions,
): Promise<IncrementalSyncResult> {
  return runIncrementalSyncBenchmark(
    openDatabase,
    synchronize as unknown as IncrementalSynchronizeFn,
    Q,
    options,
  )
}
