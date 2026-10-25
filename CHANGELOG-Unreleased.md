### Highlights

### BREAKING CHANGES

- SQLite adapter (all platforms): a database file that has tables but schema version 0 (`PRAGMA user_version`) now fails to initialize instead of being silently wiped. Version 0 normally means a new, empty database, so such a file wasn't set up by NitromelonDB, or its header is damaged, and setting it up from scratch deleted every table in it without an error. The adapter now reports it through `onSetUpError` ("... has tables but no schema version ...") and leaves the file alone. `database.unsafeResetDatabase()` is the explicit way to start over. Files with only SQLite's own tables, or Android's `android_metadata`, are still set up as new. Databases with a newer version than the app's schema are still reset, as before.
  - When this happens: the database path holds a file NitromelonDB didn't create. For example, an Electron app that stored data with plain `better-sqlite3` in `userData/app.db` (never setting `PRAGMA user_version`) and switches to NitromelonDB with the same `dbName`. Before, the first launch of the new version deleted every user's data without an error; now setup fails, so the problem shows up in development. Also: a prepopulated database built with the `sqlite3` CLI or DB Browser without setting `user_version`, a file Android's `SQLiteDatabase` created directly, or a damaged file header (rare).
  - It never happens for databases NitromelonDB or WatermelonDB created: they always set the version together with the tables.

### Deprecations

### New features

### Fixes

- SQLite adapter: after setting up the database failed, `database.unsafeResetDatabase()` now sets it up from scratch, and `database.readyPromise`, `isReady` and `seed` then behave as on a fresh install. On native and Node, this works after any failed setup: a failed migration, or a corrupt or unrecognized file (Node used to fail with `No driver for tag N`). On Node, it also recovers files too damaged to open ("file is not a database", "malformed"). On web, it works for a database with tables but no schema version; after a failed migration or a corrupt file, the reset still fails (`No wa-sqlite driver with tag N`), as before. Until the database is set up, every other database call fails with the setup error instead of reaching the database. On native, that changes release builds: debug builds stopped at an assertion, but release builds compile it out, so those calls used to run against the database as it was (after a failed migration, still on the old schema).
- SQLite Node adapter (Node.js, Electron, Jest): `unsafeResetDatabase()` on a file-backed database no longer breaks other connections to the same file ([#172](https://github.com/StasDoskalenko/NitromelonDB/issues/172)). It used to delete and recreate the file, which failed with `EBUSY` on Windows and elsewhere left the other connections on the deleted file, reading stale data until their next write failed with `SQLITE_READONLY_DBMOVED`. It now wipes the database in place, like the native adapters. In one transaction, it drops every table and view and sets up the new schema, so other connections see either the old database or the new one, never one without tables. It then runs `VACUUM` (skipped if another connection is still reading after the busy timeout). A corrupt database file can't be wiped in place, so for that case it still recreates the file, as before. (A file too damaged to open at all still can't be reset through the adapter, also as before.)
- The deprecated `@action` decorator no longer throws `Cannot read properties of undefined (reading 'table')` when it decorates a method of a `Collection` subclass. It now gets the table name when the method runs, like `@writer` and `@reader` ([#84](https://github.com/StasDoskalenko/NitromelonDB/issues/84)). Its deprecation warning now names `@action` ("Use @writer instead") instead of `Database.action()`, which `@action` users never call directly. Still once per app run and only in development.
- Android: release builds with R8 (`minifyEnabled`, which Expo SDK 58 now turns on by default) no longer abort on the first database open with `ClassNotFoundException: com.nitromelondb.NativeDatabasePath`. The library now ships consumer ProGuard rules that keep the classes and methods its C++ code finds by name over JNI.

### Performance

### Changes

- Docs: new [Custom Collections](https://github.com/StasDoskalenko/NitromelonDB/blob/master/docs-website/docs/docs/Advanced/CustomCollections.md) page covering `static associatedCollectionClass`, which lets a Model use its own `Collection` subclass for table-level `@writer` / `@reader` methods and named queries.

- Docs: the docs site now publishes [`llms.txt`](https://stasdoskalenko.github.io/NitromelonDB/llms.txt) and [`llms-full.txt`](https://stasdoskalenko.github.io/NitromelonDB/llms-full.txt) for AI coding agents, plus a plain Markdown copy of every page (`.../docs/Writers.md`). They're generated at build time from the same sources and sidebar, so they stay in sync. Every page now also has a meta description.

### Internal

- Native: removed `deleteDatabaseFile()` from the iOS, Android and Windows platform code ([#91](https://github.com/StasDoskalenko/NitromelonDB/issues/91)). Nothing called it, and its three implementations disagreed on when to throw (Android and Windows never did, despite the documented contract). Resetting a database stays in place on the open connection.
- `yarn test` now also runs on Windows in CI (`JavaScript tests (Windows)`), so the SQLite Node adapter's Windows-only fixes (drive-letter paths, file handles blocking deletes) are covered ([#90](https://github.com/StasDoskalenko/NitromelonDB/issues/90)).
