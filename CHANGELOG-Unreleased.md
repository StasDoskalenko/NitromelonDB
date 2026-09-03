### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal

- Memory-pressure trimming (the WeakValueCache-based caches and the native `sqlite3_db_release_memory` call added in 0.30.1) now logs when it actually runs — `logger.debug` on the JS side (`[Memory] <cache>: pruned N dead entries (...)`, `[Memory] Low memory signal received, notifying N listener(s)`), native `consoleLog`/`Logger` on iOS/Android — mirroring MMKV's debug logging for its own memory-warning handler, so the mechanism's activity is actually visible instead of silent.
