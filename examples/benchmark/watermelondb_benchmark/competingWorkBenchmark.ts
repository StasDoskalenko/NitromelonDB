import { Database, Model, appSchema, tableSchema } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import {
  runCompetingWorkBenchmark,
  withWarningCount,
  type CompetingWorkOptions,
  type CompetingWorkResult,
} from '../shared/competingWorkBenchmark'

// Its own database, separate from the main write/query/delete harness and the sync harness --
// see ../shared/competingWorkBenchmark.ts for what's actually measured (queue warnings, not this
// table's contents, which is why the schema is a single unused column).

const PING_TABLE = 'competing_ping'

class PingItem extends Model {
  static table = PING_TABLE
}

const schema = appSchema({
  version: 1,
  tables: [tableSchema({ name: PING_TABLE, columns: [{ name: 'note', type: 'string' }] })],
})

function openDatabase(): Database {
  const adapter = new SQLiteAdapter({ schema, dbName: 'watermelon-competing', jsi: true })
  return new Database({ adapter, modelClasses: [PingItem] })
}

export async function runCompeting(
  options: CompetingWorkOptions,
): Promise<{ result: CompetingWorkResult; warnings: number; messages: string[] }> {
  const database = openDatabase()
  return withWarningCount(() => runCompetingWorkBenchmark(database, options))
}
