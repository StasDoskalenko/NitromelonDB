# NitromelonDB sync server example

A small, complete sync backend for NitromelonDB in TypeScript: the pull and push endpoints from
[Sync / Backend](../../docs-website/docs/docs/Sync/Backend.md), on [Hono](https://hono.dev) and SQLite
(`better-sqlite3`).

It's also what the library's end-to-end sync tests run against (`yarn test:sync-e2e`), so its behavior
is tested with real NitromelonDB databases (SQLite and LokiJS) on every pull request.

> **An example, not a production backend.** There's no authentication, no per-user data, and it's one
> SQLite file in one process. It's meant to show the sync logic clearly, so you can copy it into your
> own backend.

## Run it

Requires Node.js 22.18 or newer (it runs the TypeScript directly, with no build step).

```bash
cd examples/sync-server
yarn install
yarn start              # http://127.0.0.1:3000, data in sync.db
```

| Variable                   | Default     | Meaning                                                                  |
| -------------------------- | ----------- | ------------------------------------------------------------------------ |
| `PORT`                     | `3000`      | `0` picks a free port                                                    |
| `HOST`                     | `127.0.0.1` | `0.0.0.0` to reach it from a phone on your network                       |
| `DATABASE`                 | `sync.db`   | SQLite file, or `:memory:`                                               |
| `SYNC_SERVER_SCHEMA`       | `default`   | `notes-app` syncs the example NotesApp's `notes` table instead           |
| `SYNC_SERVER_SEND_CREATED` | unset       | `1` splits pulled records into `created` and `updated` (see below first) |
| `SYNC_SERVER_TEST_HOOKS`   | unset       | `1` enables the `/__test/*` endpoints the tests use. Never in production |

The Android emulator reaches your computer at `10.0.2.2`, or run `adb reverse tcp:3000 tcp:3000` and use
`127.0.0.1`. The iOS simulator can use `127.0.0.1` directly.

## Use it from the app

```ts
import type { Database } from 'nitromelondb'
import { synchronize } from 'nitromelondb/sync'

const SERVER = 'http://127.0.0.1:3000'

export async function sync(database: Database) {
  await synchronize({
    database,
    pullChanges: async ({ lastPulledAt, schemaVersion, migration }) => {
      const query = new URLSearchParams({
        last_pulled_at: lastPulledAt ? String(lastPulledAt) : '',
        schema_version: String(schemaVersion),
        migration: JSON.stringify(migration),
      })
      const response = await fetch(`${SERVER}/sync/pull?${query}`)
      if (!response.ok) {
        throw new Error(`Pull failed: ${response.status}`)
      }
      return response.json()
    },
    pushChanges: async ({ changes, lastPulledAt }) => {
      const response = await fetch(`${SERVER}/sync/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changes, lastPulledAt }),
      })
      if (!response.ok) {
        // 409 means someone else changed the same records since this pull: sync again
        throw new Error(`Push failed: ${response.status}`)
      }
    },
    // The server sends every record as `updated` (see below)
    sendCreatedAsUpdated: true,
    migrationsEnabledAtVersion: 1,
  })
}
```

A failed sync changes nothing that can't be retried: just call `sync()` again later. After a `409`,
the next sync pulls the other changes, merges them, and pushes again.

## How it works

The code is in four files. `src/sync.ts` has all the sync logic as plain functions, and doesn't
depend on Hono, so you can copy it into an Express, Fastify or Nest app as is.

| File            | What's in it                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `src/schema.ts` | The synced tables and columns. This is the whitelist; keep it in sync with your app's `appSchema` |
| `src/db.ts`     | Table setup and the server clock                                                                  |
| `src/sync.ts`   | `pull()` and `push()`. Comments like "(push 5)" point to the rules in `Backend.md`                |
| `src/app.ts`    | The HTTP routes                                                                                   |

**Change tracking.** Every table has three extra columns: `last_modified` (when it last changed),
`server_created_at` (when the server first saw it) and `deleted` (records are never really deleted, so
that a pull can tell other devices to delete them).

**The clock.** Timestamps come from one counter in the database. Each push takes a new value, at least
the current time in milliseconds, and always greater than the last one, so a clock that goes backwards
(NTP adjustments) can't make a change invisible. A pull returns the counter's current value as
`timestamp`, read in the same transaction as the records, so nothing committed in between can be
missed.

**Pull** returns every record with `last_modified > lastPulledAt`, with deleted ones listed by id.
The first pull (`lastPulledAt` empty) returns everything that isn't deleted. After a migration, the app
sends the tables and columns it added; the server then also returns every record of a new table, and
every record where a new column has something other than its default value.

**Push** applies everything in one transaction. If any record it touches changed on the server after
`lastPulledAt` (someone else pushed in between), the whole push is rejected with `409` and a list of
the conflicting records. A `created` record that already exists is updated (the app pushed it before
but never saw the response), deleting something that's already gone is fine, and deleting a record
also deletes its descendants. Values of the wrong type are replaced with the column's default
instead of failing the push, and unknown columns are ignored.

**Writes made on the server itself** (an admin panel, another service) must update `last_modified` the
same way, using `nextTimestamp()` in the same transaction. Then devices pick them up on their next pull,
and a device pushing an old version of the same records gets a `409`.

## Why everything is sent as `updated`

`Backend.md` suggests sending a record as `created` if `server_created_at > lastPulledAt`, and as
`updated` otherwise. That goes wrong because of how sync works on the device: it pulls, then pushes,
and the `lastPulledAt` it keeps is from _before_ its own push. So the next pull returns the device's own
records again, as `created`.

If the user deleted one of them in the meantime (create, sync, delete, sync), the library sees "the
server wants me to create a record I deleted", assumes an earlier sync was interrupted, and recreates
the record. The deletion is lost without any error. It also logs "Server wants client to create record
... but it already exists locally" after every sync that follows a create.

Sending every record as `updated` (with `sendCreatedAsUpdated: true` in the app) avoids both: the
library keeps the local deletion and pushes it, which is what the user meant. This is the option
`Backend.md` mentions at the end of its tips. The `SYNC_SERVER_SEND_CREATED=1` mode is kept so the
tests can document the library behavior (`src/sync/__tests__/e2e/reliability.test.js`, marked
`test.failing`).

## Tests

From the repository root:

```bash
yarn --cwd examples/sync-server install
yarn test:sync-e2e
```

| Test file             | What it covers                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `protocol.test.js`    | The server against each numbered rule in `Backend.md`, with raw HTTP requests                                                       |
| `basics.test.js`      | Creates, updates and deletes reaching other devices; server-side changes                                                            |
| `conflicts.test.js`   | Edits of the same record on two devices, `409` and retry, edit vs. delete                                                           |
| `reliability.test.js` | Lost push responses, offline devices, the create, sync, delete, sync flow                                                           |
| `migrations.test.js`  | Migration syncs, and older app versions not clobbering newer columns                                                                |
| `convergence.test.js` | Seeded random changes on three devices; every device must end up with what the server has, with no deletion undone and nothing lost |

Every scenario runs with the SQLite (Node) and LokiJS adapters. To replay or stress the random test:
`SYNC_E2E_SEEDS=1,2,3 SYNC_E2E_STEPS=400 yarn test:sync-e2e convergence`.
