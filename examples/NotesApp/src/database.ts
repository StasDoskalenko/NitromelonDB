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
  // Whether this is the encryption build (see below)
  encryptionAvailable: boolean
}

// DEMO ONLY. A real app generates a random passphrase once (e.g. 32 random bytes as hex) and keeps
// it in the Keychain / Android Keystore (expo-secure-store, react-native-keychain), then passes a
// function that reads it as `encryption.passphrase`. Never ship a passphrase in the bundle: anyone
// can read it there. See docs/Advanced/Encryption.
export const DEMO_PASSPHRASE = 'nitromelon-notes-demo-passphrase'

export function createExampleDatabase(): ExampleDatabase {
  // The encryption build: "nitromelondb": { "encryption": true } in package.json, or
  // NITROMELONDB_ENCRYPTION=1 at pod install / Gradle build (CI builds one to test upgrading an
  // existing install, scripts/ci-notesapp-encryption-upgrade.sh). A database from the plain build
  // opens as it is ('open'), and the header's Encrypt button encrypts it in place.
  const encryptionAvailable = SQLiteAdapter.isEncryptionAvailable()
  const adapter = new SQLiteAdapter({
    schema,
    migrations,
    dbName: Platform.OS === 'windows' ? 'nitromelon-windows' : 'nitromelon-example',
    // Recommended for new apps: faster number comparisons and sorting. This app has no raw SQL it
    // could change (see the Performance guide). Existing installs convert in the background.
    storeWholeNumbersAsIntegers: true,
    onSetUpError: (error) => {
      console.error('[NitromelonDB] Failed to set up SQLite', error)
    },
    ...(encryptionAvailable
      ? { encryption: { passphrase: () => DEMO_PASSPHRASE, ifUnencrypted: 'open' as const } }
      : {}),
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
    encryptionAvailable,
  }
}
