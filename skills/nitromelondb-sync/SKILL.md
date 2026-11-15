---
name: nitromelondb-sync
description: >
  Use to add sync between an app's NitromelonDB (nitromelondb) database and a
  backend, or to fix an existing sync. Builds both sides: the pull and push
  endpoints on the backend (change tracking, a monotonic clock, consistent
  pulls, transactional pushes with conflict detection, paginated pulls,
  migration syncs, per-user scoping), and the app's sync engine around
  synchronize() (one sync at a time, retry, triggers on launch, foreground
  and local changes, logout, unsynced-changes checks). Starts from the
  reference server in examples/sync-server and tests two devices converging.
  Invoke with `/nitromelondb-sync`.
license: MIT
metadata:
  author: StasDoskalenko
  version: 0.1.0
---

# Build sync for a NitromelonDB app

NitromelonDB syncs with any backend that implements two endpoints: **pull** (changes since a timestamp) and **push** (the device's changes). The library does everything on the device: tracking local changes, applying pulled ones, resolving conflicts per column, pages, migrations. What's left is the backend, and the code in the app that decides when to sync. Both are easy to get subtly wrong, and the mistakes lose data quietly, so this skill follows the protocol exactly.

References (plain Markdown): [Sync intro](https://stasdoskalenko.github.io/NitromelonDB/docs/Sync/Intro.md), [Frontend](https://stasdoskalenko.github.io/NitromelonDB/docs/Sync/Frontend.md), [Backend](https://stasdoskalenko.github.io/NitromelonDB/docs/Sync/Backend.md), [Limitations](https://stasdoskalenko.github.io/NitromelonDB/docs/Sync/Limitations.md), [Troubleshooting](https://stasdoskalenko.github.io/NitromelonDB/docs/Sync/Troubleshoot.md). Reference backend: [`examples/sync-server`](https://github.com/StasDoskalenko/NitromelonDB/tree/master/examples/sync-server) (TypeScript; `src/sync.ts` has no framework dependencies and comments that point to each numbered rule in Backend.md).

## Step-by-step procedure

### 1. Find out what exists

- **The app:** `nitromelondb` installed, its schema (`appSchema`, `version`), migrations, models. If there's no schema yet, use the `nitromelondb-schema` skill first. An existing `synchronize(` call means this is a fix: read it and everything that calls it, and check it against steps 3 to 5.
- **Has the app shipped with this schema?** It decides `migrationsEnabledAtVersion` (step 4).
- **The backend.** Ask, and look in the repository (a monorepo often has it). One of:
  - **A backend the team controls** (Node, Python, Go, Rails, Elixir, ...) with its own database: add the two endpoints there (step 3).
  - **No backend yet:** start from `examples/sync-server`, and say what it lacks for production (authentication, per-user data, a production database).
  - **A hosted database (Supabase, Firebase, Hasura, ...):** the endpoints go in server-side functions (Edge Functions, Cloud Functions) that follow step 3. The app never syncs straight against a hosted table API.
  - **Only a REST API without change tracking, owned by someone else:** sync can't be built on it reliably. Stop, and explain what the backend team needs to add (step 3).

Never point `synchronize()` at an endpoint the team doesn't control: the database trusts what `pullChanges` returns.

### 2. Agree on the data

- **Tables and columns** must be the same on both sides, raw names (`project_id`, not `projectId`). The backend keeps a whitelist of synced tables and columns: only those are read from a push or sent in a pull.
- **IDs** are strings, made on the device for records created there (16 random characters by default). The backend stores them as they are, and creates records with ids of the same shape (`/^[a-zA-Z0-9_\-.]+$/`, no quotes or slashes).
- **Deletes the user makes** in synced tables must be `markAsDeleted()` / `prepareMarkAsDeleted()` / `query.markAllAsDeleted()`. A `destroyPermanently()` leaves no trace and is never pushed. Search the app for `destroyPermanently` and `destroyAllPermanently` on synced tables, and list each one for the user.
- **Local-only tables** still go through push. The backend ignores tables it doesn't sync (its whitelist).
- **Timestamps** in `_at` columns are the device's clock, fine for display. Sync itself uses the server's clock only.

### 3. The backend

Follow https://stasdoskalenko.github.io/NitromelonDB/docs/Sync/Backend.md rule by rule. With a Node backend, copy the logic of `examples/sync-server/src/sync.ts` and `db.ts`, and port the SQLite parts to the backend's database. The essentials:

**Change tracking.** Every synced table gets three columns, never sent to the app:

- `last_modified` (integer, milliseconds): set on every create, update and delete, from the clock below.
- `server_created_at`: when the server first saw the record.
- `deleted` (boolean): records are never really deleted, so a pull can tell other devices to delete them. (A separate tombstone table with id and `last_modified` works too.)

**The clock.** One counter for the whole database, in the database: each write takes `max(now_ms, last + 1)`, inside the write's transaction. It never goes backwards, so a server clock adjustment can't hide a change. In PostgreSQL, a one-row table updated with `greatest(...)` in the transaction does it.

**Writes from anywhere else** (admin panel, other services, jobs) must bump `last_modified` the same way, or devices never see them.

**Pull** (`GET /sync/pull?last_pulled_at&schema_version&migration&paginated&cursor`), returning `{ changes, timestamp, nextCursor? }`:

1. One read transaction, with a consistent snapshot (PostgreSQL: `REPEATABLE READ`). Read the clock's current value as `timestamp` inside it.
2. For each whitelisted table: records with `last_modified > last_pulled_at` and not deleted go in `updated` (send everything as `updated`: the app passes `sendCreatedAsUpdated: true`). Deleted ones go in `deleted`, by id. First sync (`last_pulled_at` empty or 0): every record that isn't deleted, no `deleted` list.
3. Only whitelisted columns, raw values (`string`, `number`, `boolean`, `null`), never `_status` / `_changed` / `last_modified`.
4. **Scope to the user:** only records this user may see. When access is granted, those records must show up in the next pull, and when it's revoked, their ids go in `deleted`. Track grants with `last_modified` like any change.
5. **Migration syncs:** when `migration` isn't null, also return every record of the tables in `migration.tables`, and every record where a column in `migration.columns` has a non-default value. Whitelist what may be asked for.
6. **Paginated pulls,** only when the request says `paginated=true`: at most N records per page, ordered by `(table, last_modified, id)`, every page with the first page's `timestamp` and reading only up to it, `nextCursor` carrying that timestamp and the position, `null` on the last page. A cursor the server can't continue from starts over. Apps that don't ask get one response without `nextCursor`.

**Push** (`POST /sync/push`, body `{ changes, lastPulledAt }`):

1. Validate the shape, whitelist tables and columns, check id format, check permissions per record. Sanitize values (wrong type becomes the column's default) instead of failing: a push that fails forever leaves the device unable to sync.
2. One write transaction. If any record in the push has `last_modified > lastPulledAt` on the server (changed by someone else since this device pulled), roll back and answer `409`. The app pulls, merges, and pushes again.
3. `created` with an id that already exists: update it (the device pushed before but never saw the answer). `updated` for a record that doesn't exist: create it, unless it was deleted (then `409`, so the device learns about the deletion). `deleted` for a record that doesn't exist: ignore.
4. Deleting a record also deletes its descendants (mark them deleted, with the new `last_modified`).
5. Every written row gets the transaction's new clock value. Answer success only after commit.

**Authentication:** both endpoints require the user's session, and every query is scoped by it. `401` when the session is gone: the app stops syncing and asks the user to log in, it doesn't retry.

**Test the backend** against the numbered rules, the way `src/sync/__tests__/e2e/protocol.test.js` in the NitromelonDB repository does: raw HTTP requests for each rule (first pull, incremental pull, deletes, `409` on a stale push, created-twice, delete of a missing record, migration pull, pages).

### 4. The app's sync engine

One module owns sync. Put it next to the database module (`src/db/sync.ts`):

```ts
import { AppState } from 'react-native'
import type { Database } from 'nitromelondb'
import { synchronize, hasUnsyncedChanges } from 'nitromelondb/sync'

const SYNC_URL = 'https://api.example.com/sync'

class SyncHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

// getToken(): the app's own session token. reportSyncError(error): its error reporting (without the
// sync log or changes in it).

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${SYNC_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await getToken()}`, ...init.headers },
  })
  if (!response.ok) {
    // Never resolve on a failed response: the changes would be marked as synced and never sent again
    throw new SyncHttpError(response.status, `${init.method ?? 'GET'} ${path}: ${response.status}`)
  }
  return response
}

function runSync(database: Database): Promise<void> {
  return synchronize({
    database,
    pullChanges: async ({ lastPulledAt, schemaVersion, migration, cursor }) => {
      const query = new URLSearchParams({
        last_pulled_at: lastPulledAt ? String(lastPulledAt) : '',
        schema_version: String(schemaVersion),
        migration: JSON.stringify(migration),
        paginated: 'true',
      })
      if (cursor !== undefined) {
        query.set('cursor', typeof cursor === 'string' ? cursor : JSON.stringify(cursor))
      }
      const response = await request(`/pull?${query}`)
      return response.json() // { changes, timestamp, nextCursor }: returned as is, never kept
    },
    pushChanges: async ({ changes, lastPulledAt }) => {
      await request('/push', { method: 'POST', body: JSON.stringify({ changes, lastPulledAt }) })
    },
    sendCreatedAsUpdated: true, // the backend sends every record as `updated`
    migrationsEnabledAtVersion: 1, // see below
    paginatedPulls: true,
  })
}

// One sync at a time. A call while one runs gets the running one, and makes it run once more after,
// so changes made during a sync are pushed too.
let running: Promise<void> | null = null
let again = false

export function sync(database: Database): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    try {
      do {
        again = false
        try {
          await runSync(database)
        } catch (error) {
          if (error instanceof SyncHttpError && error.status === 401) throw error
          await runSync(database) // retry once: after a 409, the second run pulls first, then pushes
        }
      } while (again)
    } finally {
      running = null
    }
  })()
  return running
}

// When to sync: after launch, when the app comes back, and shortly after local changes.
export function startSync(database: Database, syncedTables: string[]): () => void {
  const kick = () => {
    sync(database).catch(reportSyncError)
  }
  database.readyPromise.then(kick, () => {})

  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') kick()
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const changes = database.withChangesForTables(syncedTables).subscribe((change) => {
    if (!change) return // the first emission is a placeholder
    clearTimeout(timer)
    timer = setTimeout(async () => {
      // Sync's own writes leave nothing to push, so this doesn't loop
      if (await hasUnsyncedChanges({ database })) kick()
    }, 2000)
  })

  return () => {
    appState.remove()
    changes.unsubscribe()
    clearTimeout(timer)
  }
}

// Logging out: stop triggers, let a running sync finish, then wipe.
export async function resetAfterLogout(database: Database, stopSync: () => void): Promise<void> {
  stopSync()
  await running?.catch(() => {})
  await database.write(() => database.unsafeResetDatabase())
}
```

Adapt it to the app:

- **`migrationsEnabledAtVersion`:** for an app that hasn't shipped, `1` (or the schema version it will ship with). For an app that already shipped without sync, the **current** schema version, and it must be set before the next schema change. Never lower it later. The adapter must be given `migrations`.
- **`sendCreatedAsUpdated: true`** only if the backend sends everything as `updated` (recommended). If it splits `created` / `updated`, leave it out.
- **`paginatedPulls: true`** works with any backend: one that doesn't page never returns `nextCursor`.
- **Web without React Native:** replace `AppState` with `document.visibilitychange`. Node / Electron main: drop it.
- **Triggers to add if the app has them:** pull to refresh (`await sync(database)`), connectivity coming back (`@react-native-community/netinfo`), a push notification that says "data changed". All go through `sync()`.
- **Where to start it:** once, where the app knows the user is logged in (after auth, not at module load): `const stop = startSync(database, [...])`, and `stop()` on logout.
- **Showing status:** a `hasUnsyncedChanges({ database })` check for a "not synced yet" badge, and before logging out ("you have changes that haven't synced, log out anyway?").
- **Logs:** to debug, pass `log: {}` to `synchronize()` and read counts from it afterwards (`remoteChangeCount`, `pulledPages`, errors). It contains user data: never send it to an error reporter as is, and never log `changes` in production.

Leave these off unless there's a reason, and read their docs first if there is: `conflictResolver` (the default resolution is per column: local changes win, the rest comes from the server), `unsafeTurbo` (Turbo Login, only for a huge first sync into an empty database), `_unsafeBatchPerCollection`, replacement sync.

### 5. Things that break sync, to check in the app

- `synchronize()` called from inside a writer or reader: deadlock. The engine above is only called from outside.
- `pushChanges` that resolves after a failed request (no `response.ok` check, a `catch` that logs): changes are lost.
- The object returned from `pullChanges`, or the arguments of `pushChanges`, kept or changed after returning: the library reuses them.
- `unsafeResetDatabase()` while a sync runs: use `resetAfterLogout` above.
- Two `Database` instances on the same file, one syncing: the other's observers miss the changes.
- Old migrations deleted or squashed: an app updating from an old version can't do its migration sync.

### 6. Test it

**Two devices converging, automatically.** In Jest, two `Database` instances on in-memory adapters (the `jest.mock` of `nitromelondb/adapters/sqlite` with `LokiJSAdapter` from the `nitromelondb-install` skill, each with its own `dbName`) syncing over HTTP with the real backend started for the test (the reference server: `PORT=0` and `DATABASE=:memory:`). Test at least:

1. A record created on device A shows up on B after A syncs, then B syncs.
2. An update and a delete on A reach B. The delete uses `markAsDeleted()`.
3. Both edit the same record, different columns: after both sync (B's push gets `409`, the retry pulls and pushes), both have both edits.
4. A device offline for several changes, then syncing: nothing lost.
5. A first sync larger than one page (set the server's page size low): every record arrives.
6. After a schema migration that adds a column (if the backend implements migration syncs): an upgraded device pulls the column's values.

Run `sync()` from the engine in these tests, not `synchronize()` directly, so the retry and single-flight logic are tested too. If `fetch` isn't available in the test environment, use Node's global `fetch` (Node 18+).

**On a device:** create on one simulator, sync, see it on another (or on the server). Kill the app during a large first sync, start it again: it continues where it stopped.

### 7. Report

- Backend: the endpoints, the change-tracking columns and clock, scoping, paging, migration syncs, and what's missing for production.
- App: the sync module, its triggers, `migrationsEnabledAtVersion`, logout handling.
- Data: permanent deletes changed to `markAsDeleted()` in synced tables (or listed for the user to decide).
- Tests run, and their results.
- Next: the `nitromelondb-audit` skill (its sync checks) once real data flows.

## Checklist

- [ ] Backend the team controls; tables, columns and ids agreed; whitelist on the backend
- [ ] `last_modified` from a monotonic clock in every write, including writes from other services; soft deletes
- [ ] Pull: one consistent transaction, `timestamp` read inside it, user-scoped, everything as `updated`, migration syncs, pages only when asked
- [ ] Push: validated and sanitized, one transaction, `409` on records changed since `lastPulledAt`, created-twice updates, missing deletes ignored, descendants deleted
- [ ] App: `pushChanges` rejects on failure; `sendCreatedAsUpdated`, `migrationsEnabledAtVersion`, `paginatedPulls` set
- [ ] One sync at a time, retry once, debounced local-change trigger, launch and foreground triggers, `401` stops
- [ ] Logout waits for sync, then `unsafeResetDatabase()`; user deletes are `markAsDeleted()`
- [ ] Two-device convergence tests pass, including a conflict and a paged first sync
