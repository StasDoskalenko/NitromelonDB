import type { Database } from 'nitromelondb'
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

export async function syncNotes(database: Database): Promise<void> {
  await synchronize({
    database,
    pullChanges: async ({ lastPulledAt, schemaVersion, migration }) => {
      const query = new URLSearchParams({
        last_pulled_at: lastPulledAt ? String(lastPulledAt) : '',
        schema_version: String(schemaVersion),
        migration: JSON.stringify(migration),
      })
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
  })
}
