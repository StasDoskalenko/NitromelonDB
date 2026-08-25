# Database seeding

**`databaseSeed()`** lets you populate the database with data as part of setup, tied to the schema
version it was written against — the same way a schema migration's `toVersion` is.

```js
import { Database } from 'nitromelondb'
import { databaseSeed } from 'nitromelondb/Database/seed'

const database = new Database({
  adapter,
  modelClasses: [Post],
  seed: databaseSeed({
    steps: [
      {
        schemaVersion: 1,
        run: async (database) => {
          await database.batch(
            database.get(Post).prepareCreate((post) => {
              post.title = 'Hello'
            }),
          )
        },
      },
    ],
    onError: (error, { schemaVersion }) => {
      // report it however you report errors elsewhere
    },
  }),
})
```

A step runs at most once, ever, and only once the database has actually reached its
`schemaVersion` (immediately, for a fresh install already on the latest schema; after migrating,
for an existing install catching up). "Did this already happen" is tracked durably for you — `run`
doesn't need to query its own table to decide whether to write.

## Where this is a great fit

- **E2E test fixtures.** Deterministic starting data for Maestro/Detox/whatever you use, without a
  hand-rolled "seed on first render" effect racing your test framework's first assertion. Every
  read/write issued after `new Database()` (including a test's own) queues until seeding settles,
  so there's no race to work around.
- **Demos, onboarding content, local dev.** Exactly what it looks like above — give a fresh install
  something to look at.
- **Static, app-owned reference data** — a fixed list of categories, unit conversions, config rows
  that ship with the app rather than being created by users. This is the one case that's fine in
  production too (see below), because the content itself doesn't change per-install and there's
  nothing user-generated it could collide with.

## Where to be careful in production

The durable "did this already run" marker answers one specific question: *did NitromelonDB's own
seed system already run this step*. It does **not** answer *does this data already exist by some
other means*. Those are different questions, and the difference matters whenever a database might
already have content that didn't arrive via `seed`:

- **Migrating from `@nozbe/watermelondb`.** [Migrating from WatermelonDB](../Migrating.md) is
  explicitly a library swap, not a data migration — your existing SQLite file, with all its real
  user data, keeps working unchanged. The seed marker is new in NitromelonDB and never existed
  under WatermelonDB, so if you add `seed` as part of (or after) that swap, every configured step
  looks "never applied" on that carried-over database and **will run** — even though the table
  already has real content. For a step that unconditionally creates rows, that means demo/seed
  data landing on top of a real user's actual data.
- **Adding `seed` to an app you've already shipped without it.** Same gap, no WatermelonDB
  involved: any database your seed tracking has never seen before — including your own existing
  users' databases — looks identical to a fresh install from `_runSeed`'s point of view.
- **Data that arrived via sync**, a manual import, or anything else outside the seed system, for
  the same reason.

None of this is a bug to work around by avoiding `seed` — it's just what "runs once, tracked
internally" can and can't promise. For a step you're introducing onto a database that might
already be non-empty, don't rely on the marker alone: have `run` check real table state before
writing.

```js
{
  schemaVersion: 4,
  run: async (database) => {
    const posts = database.get(Post)
    const existingCount = await posts.query().fetchCount()
    if (existingCount > 0) {
      return // this table isn't actually empty -- don't seed on top of real data
    }
    await database.batch(/* ... */)
  },
}
```

This read is safe to do from inside `run` — it's exactly the case NitromelonDB's own reentrancy
handling exists for (a read triggered by `run` on itself proceeds immediately, rather than
deadlocking on `seed` finishing). For a genuinely fresh table introduced in the same schema
version as the step, or static reference data with no chance of colliding with anything, you don't
need this — the marker alone is exactly the point.

## API

### `databaseSeed({ steps, onError? })`

Validates and returns a spec you pass as `seed` to `new Database(...)`. `steps` is unordered on
input (sorted internally by `schemaVersion`) and must have at least one entry, each with a unique
`schemaVersion`.

### Step: `{ schemaVersion, run, retries? }`

- `schemaVersion` — a positive integer. The constructor throws (in development) if any step
  targets a version higher than the schema itself has reached.
- `run(database)` — can be async; failures don't mark the step applied, so it's retried (from the
  start of this step) on the next launch.
- `retries` (default `0`) — extra attempts, immediately and without delay, before a failure is
  treated as real and reported via `onError`. For a step that's occasionally flaky (a network
  fetch) rather than reliably broken — this is not a resilience/backoff system, and doesn't help a
  failure that isn't transient.

### `onError(error, { schemaVersion })`

Called once a step's attempts (including retries) are exhausted, with the last error and which
step failed. If omitted, the failure is logged via `logger.error` instead. Either way, the database
still becomes usable — a broken step just means "not (fully) seeded," not "stuck."

### Logging

Progress is logged the same way schema setup/migrations already are: a summary when steps are
pending, a line per step starting and completing, and a warning (with the error) on each failed
retry attempt. Silent when there's nothing pending.

### `Database#unsafeResetDatabase({ reapplySeed? })`

Resetting the database also clears the seed marker (it's the same underlying local storage
`unsafeResetDatabase()`'s own contract already says it wipes), so by default the reset reapplies
`seed` — from `_runSeed`'s point of view, a freshly reset database is indistinguishable from a
fresh install. `unsafeResetDatabase()` resolves only once that reapplication is done too, not just
the reset itself. Pass `{ reapplySeed: false }` to skip this for a particular reset — e.g. a "wipe
everything" debug action, as opposed to a logout/login where treating the reset database as fresh
is usually what you want.

### `Database#readyPromise` / `Database#isReady`, `useDatabaseReady(database)`

Every read/write already queues correctly without checking these — see
[Setup](../Setup.md#database-initialization). They exist for when you want to gate your own UI on
readiness explicitly (e.g. a splash screen) instead of relying on that queuing invisibly.
