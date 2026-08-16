### Highlights

- Published package types, `exports`, `rxjs` peer, and Nitro peer range so a WatermelonDB → NitromelonDB swap does not need `tsconfig` path hacks.

### BREAKING CHANGES

### Deprecations

### New features

- Documented **Observability**: nested-writer deadlocks, stuck reader/writer queue warnings, and routing logs into your APM.

### Fixes

- **npm types:** the published `package.json` now points `types` at `index.d.ts`. Ramda `merge` was leaving `"types": "src/index.ts"`, which is not in the tarball.
- **`@json` sanitizers:** `json<T>()` accepts typed sanitizers again (`(source: T) => T`). `memo` on the options object is optional.
- **`Model.id`:** assigning `record.id = 'custom'` inside `create()` / `prepareCreate()` works. It throws after create instead of silently no-op'ing.

### Performance

### Changes

- Docs site version badge tracks the npm package (including alpha/beta). It had stayed on `0.28.0` through the `0.30.0` prereleases.
- README and docs use the Nitromelon icon, link to full documentation right after the intro, and credit the original WatermelonDB.
- `rxjs` is a peer dependency (`^7.8.0`) as well as a dependency, so Yarn can hoist the host copy.
- `react-native-nitro-modules` peer range is `>=0.35.2` (was `*`).
- Published package includes an `exports` map for `nitromelondb`, `nitromelondb/decorators`, `nitromelondb/adapters/sqlite`, and other directory imports.
- Migration guide: do not retarget `native/android-jsi` or iOS `SupportingFiles` paths; Jest/Metro mocks; Expo plugin is optional on bare RN; New Architecture required, tested on RN 0.83+.
- `RelationId` is exported from the package root.

### Internal

- Publish Release authenticates npm OIDC from a `push` to `master` (or manual dispatch). `pull_request_target` merge tokens are rejected by npm (`OIDC token exchange error - package not found`).
