### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal

- Drop leftover FMDB comments and regenerate `native/iosTest` CocoaPods so the Xcode project links `NitromelonDB` (sqlite3 C API), not the old WatermelonDB/FMDB sources.

- Prepare Release: version bump **`promote`** graduates the in-progress alpha/beta to official `X.Y.Z` (changelog fold). Optional **npm dist-tag** dropdown defaults to `none` (channel tags); pick `latest` only when `npm i` should install that version.
