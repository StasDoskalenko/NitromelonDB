### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal

- Dependency security fixes (Dependabot): none of these reach the published library, they're in the example apps, the docs site and the library's dev tooling. The example Expo apps (NotesApp and both benchmark apps) move to the latest SDK 58 patch (`expo` 58.0.23, React Native 0.88.1), whose CLI no longer depends on `zod`, and pick up `node-forge` 1.4.3; `glob` 13 and `minimatch` 10, which Expo's tooling still asks for, are overridden to `glob` 14 / `minimatch` 11, the first fixed releases (Expo only calls `glob`/`globSync`/`globStream` and minimatch's `Minimatch` class, which those versions keep; `@expo/fingerprint` picks the same files before and after). NotesApp_windows gets `qs` 6.16.2, `body-parser` 1.20.9 and `minimatch` 11, docs-website `serialize-javascript` 7.1.4. The library root drops two unused or replaceable dev dependencies, `babel-plugin-module-resolver` (unused) and `rimraf` (`scripts/make.mjs` now uses `fs-extra`'s `removeSync`), which removes the last `glob` 9 / `minimatch` 8, and overrides `minimatch` 10 to 11. Left open, with no fixed release: `extract-zip` (NotesApp_windows' e2e tests, through puppeteer) and `deepmerge` (low; it's gone from the Expo apps with the SDK patch).
