import { Database } from 'nitromelondb'
import { Platform } from 'react-native'
import SQLiteAdapter from 'nitromelondb/adapters/sqlite'
import Note, { type NotesCollection } from './model/Note'
import { migrations } from './model/migrations'
import { NOTES_TABLE, schema } from './model/schema'

export type ExampleDatabase = {
  database: Database
  notes: NotesCollection
  schemaVersion: number
  sqliteEngine: string
}

export function createExampleDatabase(): ExampleDatabase {
  const adapter = new SQLiteAdapter({
    schema,
    migrations,
    dbName: Platform.OS === 'windows' ? 'nitromelon-windows' : 'nitromelon-example',
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
    // CollectionMap instantiates NotesCollection at runtime for this table
    // (Note.associatedCollectionClass); database.get()'s return type doesn't
    // know that, since it isn't parameterized per-table.
    notes: database.get<Note>(NOTES_TABLE) as NotesCollection,
    schemaVersion: schema.version,
    sqliteEngine: adapter._dispatcherType === 'nitro' ? 'Nitro SQLite' : adapter._dispatcherType,
  }
}
