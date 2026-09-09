# wa-sqlite Web Adapter for NitromelonDB

## Summary

- Preserve the existing `SQLiteAdapter` architecture and import path. It will select Nitro SQLite on native, `better-sqlite3` on Node, and wa-sqlite in browsers.
- Run wa-sqlite in a dedicated web worker using the Asyncify build and `IDBBatchAtomicVFS` for durable IndexedDB persistence and multi-tab support. This configuration requires no COOP/COEP headers. [wa-sqlite VFS comparison](https://github.com/rhashimoto/wa-sqlite/blob/master/src/examples/README.md)
- Make changes only inside `nitromelondb-wa-sqlite/NitromelonDB`; do not reference the fork.

## Public API and Packaging

- Keep:
  ```ts
  import SQLiteAdapter from 'nitromelondb/adapters/sqlite'
  ```
- Add `'wa-sqlite'` to the public `DispatcherType` union and return it from `adapter.dispatcherType` in browsers.
- Add optional web overrides:
  ```ts
  type SQLiteWebOptions = {
    wasmUrl?: string
    workerFactory?: () => Worker
  }

  type SQLiteAdapterOptions = {
    // existing options
    web?: SQLiteWebOptions
  }
  ```
- Load the packaged worker and WASM automatically under Expo Metro. `wasmUrl` supports custom hosting/CSP requirements, while `workerFactory` supports custom bundlers or worker policies.
- Reject `usesExclusiveLocking: true` on web because it conflicts with the chosen multi-connection design.
- Pin wa-sqlite 1.1.2 as a runtime dependency and include the worker bootstrap and WASM asset in the published package. [wa-sqlite package metadata](https://github.com/rhashimoto/wa-sqlite/blob/master/package.json)
- Document the automatic Expo setup, Metro’s `.wasm` asset requirement, production export verification, and custom override examples. Expo Metro workers are currently alpha and depend on bundle splitting/Expo Router. [Expo worker documentation](https://docs.expo.dev/versions/latest/config/metro/)

## Runtime Implementation

- Replace the current web dispatcher’s Node bridge with a browser dispatcher that:
  - Starts one shared worker lazily on the client.
  - Assigns request IDs and maps responses into existing `ResultCallback` callbacks.
  - Preserves FIFO ordering, including non-awaited writes followed by reads.
  - Queues operations during WASM initialization.
  - Rejects every pending callback if initialization or the worker fails.
- In the worker:
  - Instantiate `wa-sqlite-async`, register `IDBBatchAtomicVFS`, and use deterministic VFS/IndexedDB names derived from `dbName`.
  - Maintain connections and record caches by adapter connection tag.
  - Permit multiple adapters and browser tabs to open the same logical database safely.
  - Use full IndexedDB durability by default and rollback/batch-atomic journaling; do not enable unsupported WAL.
- Implement the complete SQLite dispatcher contract:
  - Schema initialization and `PRAGMA user_version` compatibility checks.
  - Transactional schema creation and sequential migrations.
  - Prepared parameter binding with boolean-to-integer normalization.
  - `find`, cached queries, ID queries, raw queries, counts, and local storage.
  - Atomic batches using begin/commit/rollback and cache changes applied only after commit.
  - Multi-statement unsafe execution, reset, and explicit connection closing.
- Match Android’s optimized sync path:
  - `provideSyncJson` stores JSON by numeric ID inside the worker.
  - `unsafeLoadFromSync` validates and imports `created` and `updated` records in one transaction, applies schema defaults, ignores unknown tables/columns, rejects unsupported change-set fields and non-empty `deleted` arrays, and returns residual non-change JSON.
  - Supplied JSON is deleted after either success or failure, with rollback on any failure.
- Reset databases transactionally by dropping user schema objects, clearing caches, recreating the encoded schema, and restoring `user_version`; do not delete the shared IndexedDB container while other connections may exist.
- Fail initialization clearly through `initializingPromise` and `onSetUpError` when Worker, IndexedDB, Web Locks, persistent storage, WASM loading, or SQLite initialization is unavailable. Do not fall back silently to Loki or memory storage.
- During SSR/static route evaluation:
  - Allow adapter modules and constructors to evaluate without opening SQLite.
  - Treat initialization as a client-only deferred resource.
  - Reject actual server-side database operations with a clear message directing server code to a server-side database.
  - Open the persistent replica normally in the separate hydrated browser runtime.

## Test Plan

- Run the shared adapter suite and all SQLite-specific tests in a real Chromium worker environment, covering queries, joins, migrations, unsafe SQL, batches, reset, local storage, reopen, and record caching.
- Add browser-specific coverage for:
  - Persistence across worker/page reloads.
  - Two adapters and two tabs reading and writing the same database.
  - Ordered non-awaited calls and concurrent request handling.
  - Transaction and migration rollback.
  - Worker startup/crash recovery and exactly-once callback completion.
  - Automatic and overridden WASM URLs.
  - Complete sync-JSON behavior and cleanup.
  - Safe SSR import/construction and rejection of server-side operations.
  - Clear initialization failure when storage capabilities are blocked.
- Add an Expo NotesApp web smoke test covering development startup and production `expo export -p web`, automatic worker/WASM loading, write/read, reload persistence, and `dispatcherType === 'wa-sqlite'`.
- Add Chromium coverage to CI while retaining existing Jest, TypeScript, published-package, Node, Android, iOS, and Windows checks.

## Assumptions

- V1 officially supports Expo SDK 57 with Metro; Vite and Webpack can use the override interfaces but are not first-class CI targets yet.
- Existing LokiJS browser data is not migrated. The wa-sqlite database begins as a fresh offline replica.
- Full durability is favored over maximum write throughput.
- “Android feature parity” covers the NitromelonDB SQLite adapter contract and SQL behavior, including the sync JSON fast path. It does not imply identical SQLite versions, native-only locking workarounds, database-file interchange, or identical performance.
- Client-only SQLite initialization is selected for SSR because the user's server-side database is the source of truth and each browser owns its separate offline replica.
