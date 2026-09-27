### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

- The dev-mode "The writer/reader you're trying to run (unnamed) can't be performed yet..." warning is less noisy and more useful: a single slow writer/reader with several things queued behind it used to print one warning per queued item (each armed its own 1500ms timer); now there's one watchdog for whichever item is actually running, which warns at most once, naming itself. Undescribed `database.write(fn)`/`database.read(fn)` calls now fall back to the function's own name instead of always saying "unnamed", and `useWriter`/`useAtomicWriter` now pass a description too. Measured on a workload of 3 slow writers + 30 uncoordinated writer/reader callers: 3 warnings now vs 32 before (and 32 on upstream WatermelonDB) for the identical workload -- see the new "Competing writers/readers" card in `examples/benchmark`.

### Performance

- React Native: handoff between queued Writers/Readers now uses `setImmediate` instead of `setTimeout(fn, 0)`, avoiding a native-timer round-trip (~1 frame) between queued writes/reads.

- iOS/Android/Windows: record queries (`fetch()`, `observe()`, and the reads `synchronize()` does before applying remote changes) no longer copy every row through Nitro's `AnyMap` on the way to JS. Rows are now read into compact positional vectors and turned into JS objects in one pass, with one property key per column instead of one per cell. In the new sync benchmark (`examples/benchmark`: 12-column records, 2,000 per `synchronize()` call, Release build, 10–20 interleaved runs per size), `synchronize()` + fetch is 14–23% faster, `fetch()` is 37–61% faster, and peak process memory is 56–154 MB (14–27%) lower. That's level with WatermelonDB's JSI adapter, and ahead of it for fetches. `Q.unsafeSqlQuery(...).unsafeFetchRaw()` gets the same path.

- `Query.markAllAsDeleted()` / `Query.destroyAllPermanently()` are dramatically faster and no longer scale with how many records match: previously each matching record was deleted individually (one `database.batch()` call, i.e. one transaction, per record), then a full row fetch per matching record even after that was batched into one transaction. Now every backend (SQLite native/iOS/Android/Windows, sqlite-node, sqlite-wasm, LokiJS) resolves and deletes matching records in a single operation via a new `DatabaseAdapter#destroyMatching()` method, and clearing a whole table (`collection.query().destroyAllPermanently()`) can take SQLite's own page-truncation fast path instead of deleting row by row. Run `yarn benchmark:destroy-all` for a real, reproducible old-vs-new timing comparison against a real SQLite database (e.g. ~1.6s vs ~11ms clearing 5,000 rows on a MacBook -- see `src/adapters/__tests__/sqliteTests/destroyAll.benchmark.js`). If you maintain a fully custom `DatabaseAdapter` (not one of the three built-in ones) that doesn't implement `destroyMatching()` yet, this still works -- it transparently falls back to the previous id-resolve-then-batch approach and logs one console warning -- but implementing it (see its doc comment in `src/adapters/type.ts`) gets you the same speedup.

### Changes

### Internal
