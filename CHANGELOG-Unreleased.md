### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal

- Sync end-to-end tests for a custom `conflictResolver` with an app-side retry loop (called for every pulled update, resolving on the retry after a rejected push, giving up and pushing later, never asked about deletions) and for migration syncs turned on after an app shipped (`migrationsEnabledAtVersion` later than the version a device logged in on, and the fallback when a device has no noted version). The Sync docs now spell out what a `conflictResolver` is called with and when it must mark a column as changed
- CI: the Android flashlight benchmark adjusts CPU, FPS and score for the CI machine's speed, like the iOS benchmark does with WatermelonDB: a fixed NotesApp build (v0.32.0, built once and cached) runs in turns with each commit's, and how it compares with its usual values is that job's machine factor. The PR comment compares the adjusted values with the median and range of master's last 10 runs (🟢 better, 🟡 within range, 🔴 clearly worse, ⬆️ / ⬇️ for the direction), and the performance page charts them (once enough runs have the reference)
