### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

- Docs: the README's Performance table and `examples/benchmark/README.md` now show v0.32.0-beta.0 against WatermelonDB 0.28, re-measured with and without JSI: 2.0× / 4.7× faster for an initial sync of a fresh install, 1.4× / 2.3× for many small syncs, 1.6× / 2.4× for a 50,000-record sync and 1.4× / 2.1× for bulk writes and deletes. A single ~50,000-record query right after a sync is faster too, by how much depends on whether the app was idle before it (1.2× to 4.3× against WatermelonDB with JSI). The stress test's query phase is 10% slower than WatermelonDB without JSI. Raw data in `examples/benchmark/results/2026-11-08-ios-v0.32.0-beta.0/`.

### Internal
