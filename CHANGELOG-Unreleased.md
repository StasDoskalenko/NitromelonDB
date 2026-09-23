### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

- `yarn install` no longer fails on Yarn Classic (`fatal: not a git repository`) or on Yarn 4 projects that don't allowlist git dependencies. The `wa-sqlite` dependency now points at a GitHub tarball of the same pinned commit instead of a git URL. The installed files are the same.

### Performance

- `Query.markAllAsDeleted()` / `Query.destroyAllPermanently()` are dramatically faster and no longer scale with how many records match: previously each matching record was deleted individually (one `database.batch()` call, i.e. one transaction, per record), then a full row fetch per matching record even after that was batched into one transaction. Now every backend (SQLite native/iOS/Android/Windows, sqlite-node, sqlite-wasm, LokiJS) resolves and deletes matching records in a single operation via a new `DatabaseAdapter#destroyMatching()` method, and clearing a whole table (`collection.query().destroyAllPermanently()`) can take SQLite's own page-truncation fast path instead of deleting row by row. Run `yarn benchmark:destroy-all` for a real, reproducible old-vs-new timing comparison against a real SQLite database (e.g. ~1.6s vs ~11ms clearing 5,000 rows on a MacBook -- see `src/adapters/__tests__/sqliteTests/destroyAll.benchmark.js`). If you maintain a fully custom `DatabaseAdapter` (not one of the three built-in ones) that doesn't implement `destroyMatching()` yet, this still works -- it transparently falls back to the previous id-resolve-then-batch approach and logs one console warning -- but implementing it (see its doc comment in `src/adapters/type.ts`) gets you the same speedup.

### Changes

- Docs: rewrote Installation and Migrating from WatermelonDB as one short path per platform and removed outdated steps. Pro Tips now explains how to open the database on Android now that Android Studio's Database Inspector can't see it.

### Internal
