### Highlights

### BREAKING CHANGES

### Deprecations

### New features

- Adapters can implement an optional `tablesWithLocalChanges(tableNames, callback)`, which sync uses to skip tables without local changes. `SQLiteAdapter` implements it; other adapters keep checking every table.

### Fixes

### Performance

- Sync in apps with many tables is no longer slower than upstream WatermelonDB. The native prepared-statement cache was capped at 50 statements; a sync runs several statements per table, in the same order every time, so apps with more than a few tables re-prepared almost every statement of every sync. With 80 tables, sync took ~45% longer in the library than on WatermelonDB (discussion #109). The cap now scales with the schema (100 + 10 per table, up to 2,000). A memory warning now also clears the cache.
- Sync no longer pays a fixed cost per table on every call. Tables whose pulled changeset is empty are skipped instead of being read (incremental strategy; replacement still processes every table), and on SQLite one query finds the tables with local changes instead of three calls per table. With 80 tables, an empty pull takes 0.5 ms instead of 3.8 ms in Node.

### Changes

### Internal

- `yarn test:native-unit` builds and runs standalone C++ unit tests (`native/tests`) against the vendored SQLite, now in CI. The first covers the statement cache.
