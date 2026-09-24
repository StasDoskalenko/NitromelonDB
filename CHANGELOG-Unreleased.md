### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

- SQLite adapters: large batches (1,000+ operations on a table) no longer drop and recreate every index in the schema. Recreating an index scans and sorts the whole table, so for chunked sync into a table that already has data, every chunk paid for the entire table. Sync got quadratically slower as the table grew. Now only the tables the batch writes to are considered, and their indices are recreated only when the batch has at least as many operations as the table has rows, which is the case where it's still faster (e.g. a bulk load into an empty table). In Node, syncing 100k records in 2,000-record chunks: initial pull 2.3s → 1.1s, update pull 3.6s → 1.3s.

- iOS/Android/Windows: record queries (`fetch()`, `observe()`, and the reads `synchronize()` does before applying remote changes) no longer copy every row through Nitro's `AnyMap` on the way to JS. Rows are now read into compact positional vectors and turned into JS objects in one pass, with one property key per column instead of one per cell. In the new sync benchmark (`examples/benchmark`: 12-column records, 2,000 per `synchronize()` call, Release build, 10–20 interleaved runs per size), `synchronize()` + fetch is 14–23% faster, `fetch()` is 37–61% faster, and peak process memory is 56–154 MB (14–27%) lower. That's level with WatermelonDB's JSI adapter, and ahead of it for fetches. `Q.unsafeSqlQuery(...).unsafeFetchRaw()` gets the same path.

- `Query.markAllAsDeleted()` / `Query.destroyAllPermanently()` are dramatically faster and no longer scale with how many records match: previously each matching record was deleted individually (one `database.batch()` call, i.e. one transaction, per record), then a full row fetch per matching record even after that was batched into one transaction. Now every backend (SQLite native/iOS/Android/Windows, sqlite-node, sqlite-wasm, LokiJS) resolves and deletes matching records in a single operation via a new `DatabaseAdapter#destroyMatching()` method, and clearing a whole table (`collection.query().destroyAllPermanently()`) can take SQLite's own page-truncation fast path instead of deleting row by row. Run `yarn benchmark:destroy-all` for a real, reproducible old-vs-new timing comparison against a real SQLite database (e.g. ~1.6s vs ~11ms clearing 5,000 rows on a MacBook -- see `src/adapters/__tests__/sqliteTests/destroyAll.benchmark.js`). If you maintain a fully custom `DatabaseAdapter` (not one of the three built-in ones) that doesn't implement `destroyMatching()` yet, this still works -- it transparently falls back to the previous id-resolve-then-batch approach and logs one console warning -- but implementing it (see its doc comment in `src/adapters/type.ts`) gets you the same speedup.

### Changes

### Internal
