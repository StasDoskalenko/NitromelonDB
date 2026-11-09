### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

- Docs: the README's Performance table and `examples/benchmark/README.md` now show v0.32.0-beta.0 against WatermelonDB 0.28, re-measured with and without JSI: 2.0× / 4.7× faster for an initial sync of a fresh install, 1.4× / 2.3× for many small syncs, 1.6× / 2.4× for a 50,000-record sync and 1.4× / 2.1× for bulk writes and deletes. A single ~50,000-record query right after a sync is faster too, by how much depends on whether the app was idle before it (1.2× to 4.3× against WatermelonDB with JSI). The stress test's query phase is 10% slower than WatermelonDB without JSI. Raw data in `examples/benchmark/results/2026-11-08-ios-v0.32.0-beta.0/`.

### Internal

- iOS sync benchmark in CI: steadier numbers on noisy runners. Other VMs on a GitHub Actions runner slowed runs down by up to ~30% within one job, enough to flag a PR with a 17% "regression" that wasn't there. The PR comment now compares each app's best run (slowdowns only ever add time) with the median ratio next to it, headlines the geometric mean of NitromelonDB's speedups over WatermelonDB JSI on Sync 5k, Sync 50k, Realistic sync and the stress test, and flags a metric only when it's more than 5% below every one of master's last 10 runs. Runs per app go from 8 to 10 (Sync, Realistic sync) and 3 to 5 (stress test). Each card also records the app's CPU time, which other VMs don't inflate (the app tells the runner when it starts, so launching isn't counted), and each job runs a fixed JS and SQLite workload (`scripts/runner-baseline.mjs`) before and after the cards, so absolute times can be compared across jobs. The Performance page charts best runs, the overall speedup, and the runner baseline.

- Dependency security fixes (Dependabot): none of these reach the published library, they're in the example apps, the docs site and the library's dev tooling. The example Expo apps (NotesApp and both benchmark apps) move to the latest SDK 58 patch (`expo` 58.0.23, React Native 0.88.1), whose CLI no longer depends on `zod`, and pick up `node-forge` 1.4.3; `glob` 13 and `minimatch` 10, which Expo's tooling still asks for, are overridden to `glob` 14 / `minimatch` 11, the first fixed releases (Expo only calls `glob`/`globSync`/`globStream` and minimatch's `Minimatch` class, which those versions keep; `@expo/fingerprint` picks the same files before and after). NotesApp_windows gets `qs` 6.16.2, `body-parser` 1.20.9 and `minimatch` 11, docs-website `serialize-javascript` 7.1.4. The library root drops two unused or replaceable dev dependencies, `babel-plugin-module-resolver` (unused) and `rimraf` (`scripts/make.mjs` now uses `fs-extra`'s `removeSync`), which removes the last `glob` 9 / `minimatch` 8, and overrides `minimatch` 10 to 11. Left open, with no fixed release: `extract-zip` (NotesApp_windows' e2e tests, through puppeteer) and `deepmerge` (low; it's gone from the Expo apps with the SDK patch).
