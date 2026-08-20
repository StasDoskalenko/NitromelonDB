### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal

- Docs Pages workflow builds with Yarn 4 inside `docs-website` (root `yarn docs:build` needs a root install) and only runs when docs-related paths change.
- Migrate the repo and example apps from Yarn Classic to Yarn 4.18 (`node-modules` linker, pinned via `packageManager` / `.yarn/releases`).
- Drop `patch-package` from the library root. There was no root `patches/` directory; the Expo `expo-modules-jsi` workaround stays in the example apps.
