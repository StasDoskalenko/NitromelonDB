### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

- `experimentalDetectNestedWriters` now catches a nested `write()` / `read()` without `callWriter()` / `callReader()` after **any** `await` inside the outer writer/reader (a `fetch()`, a timer, a helper function, a `.then()` chain), not only on the same JS turn or right after a NitromelonDB query/write ([#154](https://github.com/StasDoskalenko/NitromelonDB/issues/154)). It throws when the outer writer/reader actually waits for the nested one (awaits it, returns it, chains on it) -- the case that deadlocks. A nested writer it doesn't wait for (fire-and-forget) no longer throws; it just queues behind the outer one, as it would with the flag off. Observers reacting to a writer's changes by starting their own writer are never treated as nested. To follow the writer through `await`s, the flag uses `AsyncLocalStorage` on Node (including Jest), TC39 `AsyncContext` where available, and elsewhere (Hermes, browsers) wraps `Promise.prototype.then` while the flag is on, Zone.js-style. Verified on Hermes in the example app (`maestro/nested-writers.yaml`). Nothing changes with the flag off. Meant for development and tests: the docs now recommend `experimentalDetectNestedWriters: __DEV__` and list the measured overhead on Hermes.

### Performance

### Changes

- Fewer runtime dependencies, smaller installs. `nitromelondb` no longer depends on `wa-sqlite` (a GitHub tarball URL dependency, ~15 MB installed for every app, including React Native apps that never use the web adapter) or `sql-escape-string`. The few wa-sqlite JavaScript files the web worker uses (MIT licensed) now ship inside the package, byte-for-byte and hash-verified against the pinned upstream commit in CI, next to the wasm binary that was already bundled. SQL string quoting is now a small built-in function with the same output. Nothing changes for web users: the adapter, `web.wasmUrl`, `web.workerFactory`, and Metro/bundler setup work the same, and existing browser databases open unchanged (same WASM and VFS code). If your app imports `wa-sqlite` itself, add it to your own `package.json`; it is no longer installed as a dependency of `nitromelondb`.

### Internal
