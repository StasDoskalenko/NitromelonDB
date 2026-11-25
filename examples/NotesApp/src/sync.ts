import { localStorageKey, type Database } from 'nitromelondb'
import { synchronize } from 'nitromelondb/sync'

// The reference sync server (examples/sync-server), started with the NotesApp schema:
//   cd examples/sync-server && yarn start:notes-app
// 127.0.0.1 works on the iOS simulator as is. On an Android emulator, run
// `adb reverse tcp:3000 tcp:3000` first. Set EXPO_PUBLIC_SYNC_SERVER_URL to use another server.
export const SYNC_SERVER_URL = process.env.EXPO_PUBLIC_SYNC_SERVER_URL ?? 'http://127.0.0.1:3000'

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${SYNC_SERVER_URL}${path}`, init)
  if (!response.ok) {
    // 409 means another device changed the same notes since this pull: syncing again resolves it
    throw new Error(`${init?.method ?? 'GET'} ${path} failed with ${response.status}`)
  }
  return response
}

// Set once a sync has applied anything it pulled (a page is enough), even if it failed afterwards.
// The app offers Turbo Login only before that: synchronize() refuses unsafeTurbo once lastPulledAt
// is set, and a page of a pull already wrote records
export const hasSyncedKey = localStorageKey<boolean>('notesapp_has_synced')

// turbo: Turbo Login (docs: Sync/Frontend, "Adopting Turbo Login"). The server's response goes to
// native code as raw JSON, which inserts every record itself: much faster for a big first sync.
// Only for an install's first sync into an empty database ("a serious programmer error" otherwise,
// the docs say): the app offers it only then, e.g. after "Delete all" on a new install. Native code
// writes the records without notifying observers, so the list shows them after a restart.
// maestro-encryption/9-turbo-sync.yaml runs it on an encrypted database.
export async function syncNotes(
  database: Database,
  { turbo = false }: { turbo?: boolean } = {},
): Promise<void> {
  let pulled = false
  await synchronize({
    database,
    pullChanges: async ({ lastPulledAt, schemaVersion, migration, cursor }) => {
      const query = new URLSearchParams({
        last_pulled_at: lastPulledAt ? String(lastPulledAt) : '',
        schema_version: String(schemaVersion),
        migration: JSON.stringify(migration),
      })
      if (turbo) {
        // Turbo takes the whole pull at once, as text: don't parse it
        return { syncJson: await (await request(`/sync/pull?${query}`)).text() }
      }
      // Ask for large pulls in pages (see paginatedPulls below)
      query.set('paginated', 'true')
      if (cursor !== undefined) {
        query.set('cursor', String(cursor))
      }
      const response = await request(`/sync/pull?${query}`)
      return response.json()
    },
    pushChanges: async ({ changes, lastPulledAt }) => {
      await request('/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changes, lastPulledAt }),
      })
    },
    // The server sends every pulled record as `updated` (see examples/sync-server/README.md)
    sendCreatedAsUpdated: true,
    // Large pulls come in pages (SYNC_SERVER_PAGE_SIZE records, 1000 by default), each applied as it
    // arrives, and an interrupted pull continues where it stopped
    paginatedPulls: !turbo,
    unsafeTurbo: turbo,
    // Called for every pull (each page of a paginated one), after it's applied
    onDidPullChanges: async () => {
      pulled = true
    },
  }).finally(async () => {
    if (pulled) {
      await database.localStorage.set(hasSyncedKey, true)
    }
  })
}
