import type { Collection } from 'nitromelondb'
import { Database } from 'nitromelondb'
import { databaseSeed } from 'nitromelondb/Database/seed'
import { Platform } from 'react-native'
import SQLiteAdapter from 'nitromelondb/adapters/sqlite'
import Note from './model/Note'
import { migrations } from './model/migrations'
import { schema } from './model/schema'

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
    dbName: Platform.OS === 'windows' ? 'nitromelon-windows' : 'nitromelon-example',
    onSetUpError: (error) => {
      console.error('[NitromelonDB] Failed to set up SQLite', error)
    },
  })

  const database = new Database({
    adapter,
    modelClasses: [Note],
    seed: databaseSeed({
      steps: [
        {
          // Needs `rank` (added in migration v3) and `pinned` (v2) -- can't run against an
          // earlier schema version, which is exactly what schemaVersion here guards against.
          schemaVersion: 3,
          run: async (seedDatabase) => {
            const seedNotes = seedDatabase.get(Note)
            await seedDatabase.batch(
              // rank 1 = top: note #100 (created last, "most recent") gets rank 1, note #1 gets
              // rank 100 — matches addNote's "new note is rank 1" convention.
              ...Array.from({ length: 100 }, (_, i) =>
                seedNotes.prepareCreate((note) => {
                  note.title = `Note #${i + 1}`
                  note.body = `This is note number ${i + 1}.`
                  note.createdAt = new Date(Date.now() - (100 - i) * 60_000)
                  note.rank = 100 - i
                  note.pinned = false
                }),
              ),
            )
          },
        },
      ],
      onError: (error, { schemaVersion }) => {
        console.error(
          `[NitromelonDB] Failed to seed database (schema version ${schemaVersion})`,
          error,
        )
      },
    }),
  })

  return {
    database,
    notes: database.get(Note),
    schemaVersion: schema.version,
    sqliteEngine: adapter.dispatcherType === 'nitro' ? 'Nitro SQLite' : adapter.dispatcherType,
  }
}
