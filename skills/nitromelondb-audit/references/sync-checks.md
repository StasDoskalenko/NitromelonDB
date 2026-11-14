# Sync checks

Docs: [Sync frontend](https://stasdoskalenko.github.io/NitromelonDB/docs/Sync/Frontend.md), [Sync backend](https://stasdoskalenko.github.io/NitromelonDB/docs/Sync/Backend.md), [Limitations](https://stasdoskalenko.github.io/NitromelonDB/docs/Sync/Limitations.md), [Troubleshooting](https://stasdoskalenko.github.io/NitromelonDB/docs/Sync/Troubleshoot.md)

Read the function that calls `synchronize()` and everything that triggers it.

## Y1. `pushChanges` must fail when the backend fails

`pushChanges` has to reject unless the backend confirmed it stored the changes. If it resolves anyway, the records are marked as synced and the changes are never sent again.

Flag:

- `fetch()` without a check of `response.ok` (fetch doesn't reject on HTTP 4xx / 5xx).
- A `try / catch` inside `pushChanges` that logs and returns.
- A GraphQL call that doesn't check `errors` in the response body.
- Returning before the request finished (a missing `await`).

`pullChanges` has the same problem in a milder form: an error response parsed as if it were `{ changes, timestamp }`.

## Y2. One sync at a time

`synchronize()` shouldn't be called while another is running. The second one aborts safely, but it's wasted work and noisy errors. Look for several triggers (app start, foreground, a timer, pull to refresh, `withChangesForTables`) that all call the sync function directly.

Fix: one function that returns the running promise if there is one, or sets a "sync again when done" flag.

## Y3. Migration syncs

- `synchronize()` should get `migrationsEnabledAtVersion`. Without it, a user who updates to an app version with new tables or columns doesn't get the server's existing data for them.
  - New app: `1`, or the first schema version that shipped.
  - Existing app adding it now: the current schema version, set **before** the next schema change.
- The database must be configured with `migrations` (see S1), even an empty list.
- Old migrations must not be deleted. If the git history shows migrations were removed or squashed, an app updating from an old version may be unable to sync: High.
- `pullChanges` must pass `schemaVersion` and `migration` to the backend.

## Y4. Reset during sync

`database.unsafeResetDatabase()` (logout, "clear data") while a sync may be in flight can leave the local database inconsistent. The logout path should wait for the running sync, or cancel its trigger and wait, before resetting.

## Y5. Retry once

When a push is rejected because the server has newer data, syncing again resolves it: the second run pulls first. The sync function should retry once after a failure. Low.

## Y6. Debounce change-triggered sync

`database.withChangesForTables([...])` used to trigger sync fires for every write. It needs a debounce or throttle, or each keystroke in an auto-saving form starts a sync.

Also check it isn't subscribed to tables that sync itself writes in a way that loops: a sync that applies remote changes, fires the observer, and starts another sync forever.

## Y7. Logs and `changes` are private

- The `log` object passed to `synchronize({ log })` contains user data. It shouldn't be sent to an error reporter or shown without censoring.
- Code that logs raw `changes` in `pullChanges` / `pushChanges` and isn't behind a development check is a privacy and performance problem in production.

## Y8. Treat sync objects as consumed

- The object returned from `pullChanges` must not be stored or reused after returning it. The database may mutate it.
- The arguments of `pushChanges` must not be mutated or stored. Build the request body from them and let go.

## Y9. Paginated pulls

Without `paginatedPulls: true`, a first sync or a sync after weeks offline arrives as one response and is held in memory at once. Low, informational: recommend paginated pulls when the app has large tables.

It's opt-in on both sides. The app passes `paginatedPulls: true` and tells the server it can take pages, and the server pages only for apps that asked. Don't turn it on in the app without checking that the backend returns `nextCursor` only to clients that asked for pages: an app version without `paginatedPulls` that gets a page stores that page's timestamp and never asks for the rest.

If you see `nextCursor` in the backend's response and no `paginatedPulls: true` in the app, that's High: the app applies the first page only.

## Other things worth a line

- `synchronize()` pointed at a backend the team doesn't control. The database trusts what `pullChanges` returns.
- `sendCreatedAsUpdated`, `conflictResolver`, `unsafeTurbo`, replacement sync: don't second-guess them, but check each against its section of the docs, since each has rules of its own (Turbo Login only for the first sync into an empty database, for example).
- `hasUnsyncedChanges({ database })` is the supported way to ask whether there's something to push. Flag hand-written queries on `_status` / `_changed` that do the same.
