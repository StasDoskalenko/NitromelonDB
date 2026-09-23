### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

- iOS/Android/Windows: record queries (`fetch()`, `observe()`, and the reads `synchronize()` does before applying remote changes) no longer copy every row through Nitro's `AnyMap` on the way to JS. Rows are now read into compact positional vectors and turned into JS objects in one pass, with one property key per column instead of one per cell. In the new sync benchmark (`examples/benchmark`, 20,000 records in 2,000-record chunks, Release build), `synchronize()` is ~21% faster and query fetches are ~37% faster, which puts NitromelonDB level with or slightly ahead of WatermelonDB's JSI adapter. `Q.unsafeSqlQuery(...).unsafeFetchRaw()` gets the same path.

- `Query.markAllAsDeleted()` / `Query.destroyAllPermanently()` are dramatically faster and no longer scale with how many records match: previously each matching record was deleted individually (one `database.batch()` call, i.e. one transaction, per record), then a full row fetch per matching record even after that was batched into one transaction. Now every backend (SQLite native/iOS/Android/Windows, sqlite-node, sqlite-wasm, LokiJS) resolves and deletes matching records in a single operation via a new `DatabaseAdapter#destroyMatching()` method, and clearing a whole table (`collection.query().destroyAllPermanently()`) can take SQLite's own page-truncation fast path instead of deleting row by row. Run `yarn benchmark:destroy-all` for a real, reproducible old-vs-new timing comparison against a real SQLite database (e.g. ~1.6s vs ~11ms clearing 5,000 rows on a MacBook -- see `src/adapters/__tests__/sqliteTests/destroyAll.benchmark.js`). If you maintain a fully custom `DatabaseAdapter` (not one of the three built-in ones) that doesn't implement `destroyMatching()` yet, this still works -- it transparently falls back to the previous id-resolve-then-batch approach and logs one console warning -- but implementing it (see its doc comment in `src/adapters/type.ts`) gets you the same speedup.

### Changes

### Internal
