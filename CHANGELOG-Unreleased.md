### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

- **npm:** compile `.tsx` sources into the published tarball. `react/withDatabase.js` and `react/DatabaseProvider.js` were missing (`import from 'nitromelondb/react'` failed in Metro). The JS build only matched `.ts`/`.js`, while `tsc` still emitted their `.d.ts`.
- **SQLite:** log the underlying error when the Nitromelon HybridObject fails to load, instead of only throwing a follow-on "install react-native-nitro-modules" message.

### Performance

### Changes

### Internal
