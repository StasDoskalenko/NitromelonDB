### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

- Fewer runtime dependencies, smaller installs. `nitromelondb` no longer depends on `wa-sqlite` (a GitHub tarball URL dependency, ~15 MB installed for every app, including React Native apps that never use the web adapter) or `sql-escape-string`. The few wa-sqlite JavaScript files the web worker uses (MIT licensed) now ship inside the package, byte-for-byte and hash-verified against the pinned upstream commit in CI, next to the wasm binary that was already bundled. SQL string quoting is now a small built-in function with the same output. Nothing changes for web users: the adapter, `web.wasmUrl`, and Metro/bundler setup work the same.

### Internal
