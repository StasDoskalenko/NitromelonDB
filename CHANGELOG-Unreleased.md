### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

- SQLite Node adapter (Node.js, Electron, Jest): `unsafeResetDatabase()` on a file-backed database no longer breaks other connections to the same file ([#172](https://github.com/StasDoskalenko/NitromelonDB/issues/172)). It used to delete and recreate the file, which failed with `EBUSY` on Windows and elsewhere left the other connections on the deleted file, reading stale data until their next write failed with `SQLITE_READONLY_DBMOVED`. It now wipes the database in place, like the native adapters: it drops every table and view, resets `user_version`, then runs `VACUUM` (skipped if another connection is still reading after the busy timeout). A corrupt database file can't be wiped in place, so for that case it still recreates the file, which keeps `unsafeResetDatabase()` working as a way out of corruption.
- The deprecated `@action` decorator no longer throws `Cannot read properties of undefined (reading 'table')` when it decorates a method of a `Collection` subclass. It now gets the table name when the method runs, like `@writer` and `@reader` ([#84](https://github.com/StasDoskalenko/NitromelonDB/issues/84)). Its deprecation warning now names `@action` ("Use @writer instead") instead of `Database.action()`, which `@action` users never call directly. Still once per app run and only in development.
- Android: release builds with R8 (`minifyEnabled`, which Expo SDK 58 now turns on by default) no longer abort on the first database open with `ClassNotFoundException: com.nitromelondb.NativeDatabasePath`. The library now ships consumer ProGuard rules that keep the classes and methods its C++ code finds by name over JNI.

### Performance

### Changes

- Docs: new [Custom Collections](https://github.com/StasDoskalenko/NitromelonDB/blob/master/docs-website/docs/docs/Advanced/CustomCollections.md) page covering `static associatedCollectionClass`, which lets a Model use its own `Collection` subclass for table-level `@writer` / `@reader` methods and named queries.

### Internal

- `yarn test` now also runs on Windows in CI (`JavaScript tests (Windows)`), so the SQLite Node adapter's Windows-only fixes (drive-letter paths, file handles blocking deletes) are covered ([#90](https://github.com/StasDoskalenko/NitromelonDB/issues/90)).
