# wa-sqlite web adapter

NitromelonDB's SQLite adapter uses [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) in
browsers. It preserves the existing public import and database-adapter contract while replacing
the former LokiJS web storage path with persistent SQLite backed by IndexedDB.

This implementation is intended to make the browser an offline SQLite replica with behavior close
to the native Android SQLite adapter. It does not turn the browser database into a server database:
the application's remote database remains authoritative, and NitromelonDB synchronization still
pulls, applies, queues, and pushes changes at the application layer.

## Platform selection

The same import selects a platform-specific implementation:

| Runtime | SQLite implementation | Dispatcher type |
| --- | --- | --- |
| Android, iOS, and Windows | Nitro SQLite | `nitro` |
| Node.js | `better-sqlite3` | `asynchronous` |
| Browser | wa-sqlite Asyncify in a web worker | `wa-sqlite` |

```ts
import SQLiteAdapter from 'nitromelondb/adapters/sqlite'

const adapter = new SQLiteAdapter({
  dbName: 'wa-sqlite-db-offline',
  schema,
  migrations,
  onSetUpError(error) {
    console.error('Could not initialize the offline database', error)
  },
})

console.log(adapter.dispatcherType) // "wa-sqlite" in a hydrated browser
```

Pass the adapter to `new Database(...)` exactly as on native. Normal database operations queue
behind adapter setup. Code that uses the adapter directly, especially test infrastructure, can
await `adapter.initializingPromise` before issuing SQL. Applications should surface
`onSetUpError` rather than treating initialization failure as an empty database.

There is no silent fallback to LokiJS or an in-memory database. An unavailable worker, WASM asset,
IndexedDB, Web Locks API, or `BroadcastChannel` produces an initialization error.

## Architecture

The browser implementation has four layers:

| Layer | Responsibility |
| --- | --- |
| `SQLiteAdapter` | Encodes schemas, migrations, queries, and batches using the existing adapter API. |
| Web dispatcher | Lazily creates a shared worker, assigns request IDs, maps responses to callbacks, and rejects pending work if the worker fails. |
| Worker runtime | Initializes wa-sqlite, owns connections and VFS instances, serializes requests, coordinates cache invalidation, and dispatches the SQLite contract. |
| `DatabaseDriver` | Executes SQL, binds values, manages transactions and record caches, imports sync JSON, and implements reset and local storage behavior. |

The worker loads the packaged `wa-sqlite-async` build. Asyncify allows SQLite's synchronous VFS
calls to wait for asynchronous IndexedDB operations without requiring `SharedArrayBuffer`, COOP, or
COEP headers.

Each logical `dbName` gets a deterministic VFS and IndexedDB name. The SQLite filename inside that
VFS is fixed, while the VFS namespace isolates one logical NitromelonDB database from another.
`IDBBatchAtomicVFS` uses rollback/batch-atomic journaling and strict IndexedDB transaction
durability. WAL is deliberately not enabled.

## What changed in this fork

The web implementation adds or changes the following pieces without changing the established
SQLite adapter import:

- the browser dispatcher now talks to a dedicated wa-sqlite worker instead of using the Node
  bridge or selecting LokiJS;
- `wa-sqlite` is pinned to immutable upstream commit
  `2bf1c59d89eb6497535a4217bc62fec68a0bb994`, and the published package contains its worker
  bootstrap, Asyncify module, and WASM asset;
- `wa-sqlite` is part of the public `DispatcherType` union and is exposed through
  `adapter.dispatcherType`;
- `SQLiteAdapterOptions.web` accepts optional `wasmUrl` and `workerFactory` overrides;
- the worker implements the full SQLite dispatcher contract, including schema setup, migrations,
  batches, reset, local storage, unsafe SQL, record caching, and sync JSON;
- initialization is deferred safely during SSR and actual server-side SQLite operations are
  rejected;
- adapters for the same logical database in one worker share a reference-counted SQLite connection,
  while separate tabs coordinate their connections through IndexedDB and Web Locks;
- committed writes invalidate record caches in other connections and browser tabs; and
- the NotesApp production export and Chromium suite exercise the real worker, WASM, IndexedDB,
  persistence, and multi-tab paths.

## Upstream review follow-up

The initial implementation received an upstream review covering native safety, database reopen
correctness, production worker transforms, dependency provenance, test isolation, and smaller
correctness issues. The following changes address that review.

### Native NotesApp safety and test-harness scope

The adapter-test route no longer runs through the cross-platform `App.tsx`. React Native defines a
`window` alias without defining `window.location`, so checking only `typeof window` could throw
during the first native render. The NotesApp now uses platform-specific entry modules:

- `App.tsx` always renders the normal native NotesApp;
- `App.web.tsx` reads `globalThis.location?.search` and lazily imports the browser adapter-test
  screen only when `?adapter-tests=1` is present; and
- `webRuntime.web.ts` imports `@expo/metro-runtime`, while the native `webRuntime.ts` is empty.

This keeps URL access, the Metro web runtime, and adapter test dependencies out of the native
render path. It also leaves the browser test harness in a separate lazy web chunk instead of the
normal application module graph.

### Reopen, migration, and initialization ordering

The worker originally created one SQLite handle per adapter tag. Multiple handles backed by the
same `IDBBatchAtomicVFS` could observe stale SQLite header state, including an old
`PRAGMA user_version`, immediately after another handle committed. The worker now owns one
reference-counted SQLite handle and VFS per deterministic logical `dbName`. Adapter tags retain
separate `DatabaseDriver` instances and record caches but share that handle. The last tag to close
releases the SQLite connection and VFS without deleting IndexedDB.

A second race existed between the adapter's two-phase setup and ordinary operations. After
`initialize` returned `schema_needed` or `migrations_needed`, a batch or query could enter the
worker before the adapter callback submitted `setUpWithSchema` or `setUpWithMigrations`. Each web
dispatcher now gates ordinary operations until setup reaches `ready`, preserves their FIFO order,
and rejects the queued callbacks if setup fails.

The Chromium migration cases also needed independent starting databases. The suite creates a
baseline adapter before invoking each shared test, so a test that constructs its own v1 schema must
not reuse that already-initialized database. Custom multi-hop and create-table migration tests now
derive isolated names from the per-test `dbName`, inserting their suffix before SQLite URI query
parameters. Their subsequent `testClone()` calls continue to reopen the same derived database.

### Production worker transforms and unsafe SQL

`module:fast-async` (nodent) is excluded from every TypeScript source under
`adapters/sqlite/sqlite-wasm` and from the worker bootstrap. The Babel path matcher accepts
absolute, normalized, and linked-package paths, which matters when the NotesApp consumes this
repository through `link:../..`. Worker code therefore retains native async iteration in minified
Expo exports, preventing `unsafeExecuteMultiple` from stalling while consuming prepared
statements.

Prepared statements are now explicitly finalized before the next command, commit, or rollback.
Multi-statement execution exhausts every statement, including row-producing pragmas. Parameter
binding checks the `bind_collection` return code and reports a clear SQLite result instead of
continuing after a failed bind. `find` uses the conventional `id = ?` predicate.

### Dependency integrity and VFS compatibility

The wa-sqlite dependency now references immutable commit
`2bf1c59d89eb6497535a4217bc62fec68a0bb994` rather than the mutable `v1.1.2` tag. The packaged
Emscripten glue and WASM binary have recorded upstream provenance, SHA-256 hashes, and the reason
for the Metro-specific glue patch in `src/adapters/sqlite/sqlite-wasm/VENDOR.md`.

Importing `IDBBatchAtomicVFS` from wa-sqlite's examples directory remains an interim dependency on
a non-public API. Worker startup now validates the expected static `create()` and instance
`close()` functions and emits an explicit incompatibility error if the pinned shape changes. Full
vendoring and automated upstream updates remain follow-up work; see [Future improvements](#future-improvements).

### Cache, sync JSON, and worker identity hardening

- Cross-connection writes still use the safe v1 policy of clearing all matching materialization
  caches. This changes only a JavaScript optimization and does not remove offline SQLite data.
- Pending sync JSON is scoped by adapter tag, removed after import success or failure, and discarded
  when the tag closes, preventing abandoned entries from living for the entire shared-worker
  lifetime.
- Worker identities use `crypto.randomUUID()` where available, with the previous timestamp/random
  construction retained only as a compatibility fallback.
- JavaScript `bigint` values are still converted to `number`, consistent with the existing adapter
  contract. Values outside JavaScript's safe-integer range can lose precision and remain a known
  boundary.

### CI and browser diagnostics

The repository root now exposes `yarn test:web`, which delegates to the NotesApp production export
and Playwright suite. The browser runner records a timed-out case and continues with later cases
instead of hiding the remainder of the suite. Assertion messages are preserved alongside browser
stacks, and CI uploads `playwright-report` and `test-results` when the web job fails.

The static export is served by a small Node script rather than a platform-dependent `python`
command. Browser test cases use unique logical database names, and custom-schema migration tests
use derived names so the harness's baseline schema cannot contaminate their initial state. The
focused dispatcher tests cover SSR behavior, exclusive-lock rejection, worker failure/recovery,
exactly-once callbacks, override URLs, and the two-phase setup queue.

The review also suggested running both minified and non-minified browser exports. Production
exports are the required CI path today because that is where the original worker-transform failure
appeared; adding a second development-mode browser job remains optional future coverage.

### Request ordering

Calls from the main thread carry a monotonically increasing request ID. The worker processes its
request queue in FIFO order, including calls whose returned promises are not immediately awaited.
This preserves sequences such as a write followed immediately by a read. Each web dispatcher also
holds application operations until the adapter's two-phase initialization has either reported
`ok` or completed schema creation/migration. This matches the native bridge's waiting-connection
behavior and prevents an immediate query or batch from overtaking schema setup. Requests arriving
during WASM initialization remain queued.

All outstanding callbacks are rejected exactly once if the worker crashes or returns an unreadable
message. The failed worker is terminated, and a later adapter initialization can create a new
worker. An adapter whose worker died should be recreated because its old connection existed only in
the terminated worker.

### Connections and VFS lifetime

Multiple adapters can share one logical database. Inside one worker, adapter connection tags are
multiplexed onto one SQLite connection per deterministic `dbName`. This avoids divergent SQLite
pager and VFS state and keeps the WASM footprint bounded. Separate tabs have separate workers and
SQLite connections, coordinated by the shared IndexedDB database and Web Lock namespace.

- opening another adapter for the same `dbName` increments the database connection's reference
  count;
- explicit connection closure decrements it and closes SQLite and the VFS after the final owner;
- failed database opens, configuration, schema creation, and migrations release resources;
- a failed global WASM/runtime initialization clears the failed promise so a later attempt can retry.

Closing the VFS does not delete its IndexedDB database. Reopening the same `dbName` therefore loads
the same offline data.

## Transactions and supported behavior

The web driver implements the SQLite adapter contract rather than translating queries into another
database language:

- schema creation and `PRAGMA user_version` checks;
- sequential migrations with a version recheck under the write transaction;
- prepared bindings, including boolean-to-integer normalization;
- explicitly awaited prepared-statement finalization before commit, rollback, or the next SQL
  command;
- finds, cached queries, ID queries, raw queries, counts, and local storage;
- atomic batches with commit/rollback and cache updates only after commit;
- multi-statement unsafe execution;
- transactional reset that drops user schema objects and recreates the encoded schema;
- explicit connection closure; and
- the optimized sync-JSON import path.

Reset does not delete the shared IndexedDB container, because another connection or tab may still
be using it.

### Sync JSON

`provideSyncJson()` stores the supplied JSON inside the worker under its numeric ID.
`unsafeLoadFromSync()` then imports `created` and `updated` records in one transaction, applies
schema defaults, ignores unknown tables and columns, and returns the non-`changes` portion of the
JSON.

The fast path rejects unknown change-set operations and non-empty `deleted` arrays. The supplied
JSON is removed after success or failure, and any failed import is rolled back. Pending JSON is
scoped to the adapter connection and is also discarded when that connection closes, so an aborted
two-step import does not survive for the lifetime of the shared worker.

## Offline behavior and cache invalidation

Cross-connection cache invalidation does **not** require a network connection and does not remove,
expire, or rewrite offline records. SQLite remains stored in IndexedDB and all normal reads and
writes continue offline.

NitromelonDB's adapter cache remembers which records have already been materialized in JavaScript.
For such records, a query can return only an ID and reuse the existing model. That optimization is
unsafe if another adapter or tab changes the record without clearing the first connection's cache.

After a successful commit, the worker therefore:

1. clears affected record-materialization caches on other local connections;
2. broadcasts the logical database name to workers in other tabs; and
3. clears matching caches when those workers receive the message.

The next read may decode a complete row instead of returning only its ID. This is a small CPU and
allocation cost after cross-connection writes, not a loss of offline functionality. The writing
connection keeps its precise cache changes after a normal batch; broad operations such as reset,
migration, sync import, and unsafe SQL clear all matching caches.

Cache invalidation is not cross-tab reactive observation. An observable query is not automatically
notified merely because another tab committed. Applications that need a live multi-tab UI should
broadcast an application event and re-query, or trigger the normal synchronization/refresh flow.

## Expo Metro setup

Expo SDK 57 with Metro is the first-class web target. Projects without Expo Router must load
Metro's bundle-splitting runtime on web. Keep it out of native bundles with a platform module:

```ts
// webRuntime.web.ts
import '@expo/metro-runtime'

// webRuntime.ts (native)
// intentionally empty

// index.ts
import './webRuntime'
```

Preserve Expo's Metro defaults and ensure `.wasm` is treated as an asset:

```js
const { getDefaultConfig } = require('expo/metro-config')
const config = getDefaultConfig(__dirname)

if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm')
}

module.exports = config
```

The package includes the worker bootstrap, Asyncify JavaScript module, and WASM binary. No manual
URL is needed for the standard Expo configuration.

Before release, run:

```bash
npx expo export -p web
```

Verify that the export contains both a worker chunk and the `.wasm` asset, then serve the export and
perform a write/reload persistence check. Development startup alone does not prove that production
asset URLs are correct.

## Custom WASM and worker policies

Use overrides when a CDN, Content Security Policy, or non-Metro bundler controls asset locations:

```ts
const adapter = new SQLiteAdapter({
  dbName: 'wa-sqlite-db-offline',
  schema,
  web: {
    wasmUrl: 'https://static.example.com/nitromelondb/wa-sqlite-async.wasm',
    workerFactory: () => new Worker('/workers/nitromelondb-sqlite.js'),
  },
})
```

`wasmUrl` is resolved relative to the page. `workerFactory` must return a dedicated worker running
NitromelonDB's worker bootstrap and must satisfy the site's CSP. Vite and Webpack can use these
interfaces, but they are not first-class CI targets yet.

## SSR and static rendering

Adapter modules and constructors are safe to evaluate without creating a worker during SSR. The
actual persistent replica is a client-only resource. Server-side database operations reject with a
message directing server code to its authoritative database.

The hydrated browser must create its own application/database instance. Do not reuse the logical
assumption that an adapter initialized during server rendering has an open browser connection.

## Multi-tab rules

- Use the same `dbName` for tabs that should share an offline replica.
- Use the same schema and migration set in every concurrently deployed tab.
- Keep transactions short; tabs serialize conflicting IndexedDB/SQLite locks.
- Do not set `usesExclusiveLocking: true`. It is rejected on web.
- Treat another tab's writes as externally committed data and explicitly refresh UI state when live
  cross-tab presentation matters.

## Known issues and boundaries

- Existing LokiJS browser data is not migrated. The wa-sqlite database starts as a fresh replica and
  should be rebuilt from the authoritative backend.
- Browser storage remains subject to quota management, user clearing, private-browsing rules, and
  browser eviction policies. Strict IndexedDB durability is not the same as a server backup.
- `BroadcastChannel`, IndexedDB, Web Workers, WebAssembly, and the Web Locks API are required.
- WAL and `usesExclusiveLocking` are unsupported by this multi-connection design.
- Cross-tab cache invalidation does not automatically notify NitromelonDB observable queries.
- A worker crash rejects in-flight operations. Recreate the affected adapter/database instance
  before retrying application work.
- Only one WASM URL is accepted within a worker runtime. Different custom policies should use
  distinct worker instances.
- Android and web have adapter-contract and SQL-behavior parity, not identical SQLite versions,
  performance, database-file interchange, or native-only locking workarounds.
- Sync JSON intentionally rejects non-empty `deleted` arrays; deletion handling remains in the
  regular synchronization path.
- Expo SDK 57 Metro is tested first. Other bundlers currently require explicit integration and
  overrides.

## Testing

The implementation uses two complementary test levels:

- `FakeSqliteApi` driver tests isolate binding, transaction rollback, sync defaults, cleanup, and
  cache state without involving browser infrastructure.
- Chromium tests run the real packaged worker, WASM build, SQLite engine, IndexedDB VFS, shared
  adapter suite, persistence reload, multiple adapters, and multiple tabs.

The fake API is intentionally retained. It provides fast and deterministic unit-level failure
tests; it does not replace real SQLite coverage.

The NotesApp web check exports the production app before running Playwright. It verifies automatic
worker/WASM loading, `dispatcherType === 'wa-sqlite'`, write/read behavior, reload persistence, and
concurrent writes from two tabs.

## Future improvements

- Add a supported migration utility for existing LokiJS browser replicas.
- Add an application-facing cross-tab change notification or observable-refresh hook.
- Add first-class Vite and Webpack worker/asset plugins and CI fixtures.
- Evaluate a durable cross-worker generation counter as an additional cache-invalidation safeguard.
- Add recovery helpers that rebuild an existing database instance after a worker crash.
- Expose storage-quota diagnostics and optional persistent-storage permission guidance.
- Benchmark strict durability and provide documented, explicit performance profiles if a safe
  configuration surface can be designed.
- Track newer wa-sqlite and SQLite releases while preserving migration and multi-tab compatibility.
- Replace the commit-pinned dependency with a fully vendored wa-sqlite source subset and automated
  weekly update workflow. The current binary hashes and Metro glue patch are recorded in
  `src/adapters/sqlite/sqlite-wasm/VENDOR.md` as the auditable intermediate state.
