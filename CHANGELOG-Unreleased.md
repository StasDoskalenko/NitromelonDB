### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

- Sync in apps with many tables is no longer slower than upstream WatermelonDB. The native prepared-statement cache was capped at 50 statements; a sync runs several statements per table, in the same order every time, so apps with more than a few tables re-prepared almost every statement of every sync. With 80 tables, sync took ~45% longer in the library than on WatermelonDB (discussion #109). The cap now scales with the schema (100 + 10 per table, up to 2,000). A memory warning now also clears the cache.

### Changes

### Internal

- `yarn test:native-unit` builds and runs standalone C++ unit tests (`native/tests`) against the vendored SQLite, now in CI. The first covers the statement cache.
