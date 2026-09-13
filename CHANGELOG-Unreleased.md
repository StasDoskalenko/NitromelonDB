### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

- `Query.markAllAsDeleted()` / `Query.destroyAllPermanently()` are dramatically faster and no longer scale with how many records match: previously each matching record was deleted individually (one `database.batch()` call, i.e. one transaction, per record), then a full row fetch per matching record even after that was batched into one transaction. Now every backend (SQLite native/iOS/Android/Windows, sqlite-node, sqlite-wasm, LokiJS) resolves and deletes matching records in a single operation, and clearing a whole table (`collection.query().destroyAllPermanently()`) can take SQLite's own page-truncation fast path instead of deleting row by row. Run `yarn benchmark:destroy-all` for a real, reproducible old-vs-new timing comparison against a real SQLite database (e.g. ~1.6s vs ~11ms clearing 5,000 rows on a MacBook -- see `src/adapters/__tests__/sqliteTests/destroyAll.benchmark.js`).

### Changes

### Internal
