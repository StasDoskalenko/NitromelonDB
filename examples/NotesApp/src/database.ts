import { Database, type Collection } from 'nitromelondb'
import SQLiteAdapter from 'nitromelondb/adapters/sqlite'
import Note from './model/Note'
import { migrations } from './model/migrations'
import { NOTES_TABLE, schema } from './model/schema'

export type ExampleDatabase = {
  database: Database
  notes: Collection<Note>
  schemaVersion: number
  sqliteEngine: string
}

export function createExampleDatabase(): ExampleDatabase {
  const adapter = new SQLiteAdapter({
    schema,
    migrations,
    dbName: 'nitromelon-example',
    onSetUpError: (error) => {
      console.error('[NitromelonDB] Failed to set up SQLite', error)
    },
  })

  const database = new Database({
    adapter,
    modelClasses: [Note],
  })

  return {
    database,
    notes: database.get<Note>(NOTES_TABLE),
    schemaVersion: schema.version,
    sqliteEngine: adapter._dispatcherType === 'nitro' ? 'Nitro SQLite' : adapter._dispatcherType,
  }
}
