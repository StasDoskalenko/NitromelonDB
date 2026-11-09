### Highlights

### BREAKING CHANGES

### Deprecations

### New features

- `new SQLiteAdapter({ storeWholeNumbersAsIntegers: true })` stores whole numbers as SQLite `INTEGER` instead of `REAL` (iOS, Android, Windows and Node; web ignores it). Queries that scan or sort a table get faster (10% for the stress test's queries in the benchmark app, now ahead of WatermelonDB there); sync and writes stay within 1 to 2%. Data already on the device is converted once, in the background, after the database opens: values don't change, records aren't marked as changed, and it continues on the next launch if interrupted. Off by default, because raw SQL (`Q.unsafeSqlQuery`, `Q.unsafeSqlExpr`, `unsafeExecute`) can see the difference: `/` between two whole numbers is integer division, turning one into text gives `'42'` instead of `'42.0'` (this also affects `Q.like` and `Q.includes` on number columns), and `typeof()` returns `integer`. Queries built with `Q`, models and sync behave the same. Development builds warn about raw SQL that might be affected. See [Performance](https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/Performance) for how to check whether it's safe for your app.

### Fixes

### Performance

### Changes

- Docs: the README's Performance table and `examples/benchmark/README.md` now show v0.32.0-beta.0 against WatermelonDB 0.28, re-measured with and without JSI: 2.0× / 4.7× faster for an initial sync of a fresh install, 1.4× / 2.3× for many small syncs, 1.6× / 2.4× for a 50,000-record sync and 1.4× / 2.1× for bulk writes and deletes. A single ~50,000-record query right after a sync is faster too, by how much depends on whether the app was idle before it (1.2× to 4.3× against WatermelonDB with JSI). The stress test's query phase is 10% slower than WatermelonDB without JSI. Raw data in `examples/benchmark/results/2026-11-08-ios-v0.32.0-beta.0/`.

### Internal

- Dependency security fixes (Dependabot): none of these reach the published library, they're in the example apps, the docs site and the library's dev tooling. The example Expo apps (NotesApp and both benchmark apps) move to the latest SDK 58 patch (`expo` 58.0.23, React Native 0.88.1), whose CLI no longer depends on `zod`, and pick up `node-forge` 1.4.3; `glob` 13 and `minimatch` 10, which Expo's tooling still asks for, are overridden to `glob` 14 / `minimatch` 11, the first fixed releases (Expo only calls `glob`/`globSync`/`globStream` and minimatch's `Minimatch` class, which those versions keep; `@expo/fingerprint` picks the same files before and after). NotesApp_windows gets `qs` 6.16.2, `body-parser` 1.20.9 and `minimatch` 11, docs-website `serialize-javascript` 7.1.4. The library root drops two unused or replaceable dev dependencies, `babel-plugin-module-resolver` (unused) and `rimraf` (`scripts/make.mjs` now uses `fs-extra`'s `removeSync`), which removes the last `glob` 9 / `minimatch` 8, and overrides `minimatch` 10 to 11. Left open, with no fixed release: `extract-zip` (NotesApp_windows' e2e tests, through puppeteer) and `deepmerge` (low; it's gone from the Expo apps with the SDK patch).
