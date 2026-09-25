### Highlights

### BREAKING CHANGES

### Deprecations

### New features

- `Collection.findAndObserveOrNull(id)`: like `findAndObserve(id)`, but emits `null` instead of erroring when the record doesn't exist, so a missing record no longer throws out of `withObservables`. It also emits the record once it's created (e.g. by sync) and emits `null` instead of completing when it's deleted. `findAndObserve` is unchanged.
- `Q.sortBy()` accepts `Q.unsafeSqlExpr()` on SQLite adapters, e.g. `Q.sortBy(Q.unsafeSqlExpr('CAST(image_id AS INTEGER)'), Q.desc)`. LokiJS rejects it with a clear error.

### Fixes

- Observing a query whose only condition is `Q.unsafeSqlExpr()` / `Q.unsafeLokiExpr()` (including inside `Q.and` / `Q.or`) no longer throws `Illegal clause sql` when the table changes, e.g. during sync. The same goes for a `Q.on` nested inside `Q.and` / `Q.or`, which used to throw `Illegal Q.on`. Such queries now re-run on change instead of being matched in JavaScript ([WatermelonDB#1679](https://github.com/Nozbe/WatermelonDB/discussions/1679), approach from [WatermelonDB#1977](https://github.com/Nozbe/WatermelonDB/pull/1977)).
- `yarn install` no longer fails on Yarn Classic (`fatal: not a git repository`) or on Yarn 4 projects that don't allowlist git dependencies. The `wa-sqlite` dependency now points at a GitHub tarball of the same pinned commit instead of a git URL. The installed files are the same.

### Performance

- SQLite adapters: large batches (1,000+ operations on a table) no longer drop and recreate every index in the schema. Recreating an index scans and sorts the whole table, so for chunked sync into a table that already has data, every chunk paid for the entire table. Sync got quadratically slower as the table grew. Now only the tables the batch writes to are considered, and their indices are recreated only when the batch has at least as many operations as the table has rows, which is the case where it's still faster (e.g. a bulk load into an empty table). On web (wa-sqlite), where the adapter can't check row counts without delaying the batch behind later calls, large batches no longer recreate indices at all. That costs up to ~20% only on one-shot bulk loads into an empty table. In Node, syncing 100k records in 2,000-record chunks: initial pull 2.3s → 1.1s, update pull 3.6s → 1.3s.

- iOS/Android/Windows: record queries (`fetch()`, `observe()`, and the reads `synchronize()` does before applying remote changes) no longer copy every row through Nitro's `AnyMap` on the way to JS. Rows are now read into compact positional vectors and turned into JS objects in one pass, with one property key per column instead of one per cell. In the new sync benchmark (`examples/benchmark`: 12-column records, 2,000 per `synchronize()` call, Release build, 10–20 interleaved runs per size), `synchronize()` + fetch is 14–23% faster, `fetch()` is 37–61% faster, and peak process memory is 56–154 MB (14–27%) lower. That's level with WatermelonDB's JSI adapter, and ahead of it for fetches. `Q.unsafeSqlQuery(...).unsafeFetchRaw()` gets the same path.

- `Query.markAllAsDeleted()` / `Query.destroyAllPermanently()` are dramatically faster and no longer scale with how many records match: previously each matching record was deleted individually (one `database.batch()` call, i.e. one transaction, per record), then a full row fetch per matching record even after that was batched into one transaction. Now every backend (SQLite native/iOS/Android/Windows, sqlite-node, sqlite-wasm, LokiJS) resolves and deletes matching records in a single operation via a new `DatabaseAdapter#destroyMatching()` method, and clearing a whole table (`collection.query().destroyAllPermanently()`) can take SQLite's own page-truncation fast path instead of deleting row by row. Run `yarn benchmark:destroy-all` for a real, reproducible old-vs-new timing comparison against a real SQLite database (e.g. ~1.6s vs ~11ms clearing 5,000 rows on a MacBook -- see `src/adapters/__tests__/sqliteTests/destroyAll.benchmark.js`). If you maintain a fully custom `DatabaseAdapter` (not one of the three built-in ones) that doesn't implement `destroyMatching()` yet, this still works -- it transparently falls back to the previous id-resolve-then-batch approach and logs one console warning -- but implementing it (see its doc comment in `src/adapters/type.ts`) gets you the same speedup.

### Changes

- Docs: rewrote Installation and Migrating from WatermelonDB as one short path per platform and removed outdated steps. Pro Tips now explains how to open the database on Android now that Android Studio's Database Inspector can't see it.

### Internal
