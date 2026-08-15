### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal

- Prepare Release skips versions that already have a git tag, GitHub Release, or npm publish, and only reuses a leftover `release/v…` branch when none of those exist.
- Prepare Release folds all same-version alpha/beta changelog entries into one official entry when graduating to a stable release.
