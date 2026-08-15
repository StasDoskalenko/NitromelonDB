### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal

- Prepare Release accepts version bump `none` so another alpha/beta of the same X.Y.Z does not require picking patch/minor/major.
- Prepare Release skips versions that already have a git tag, GitHub Release, or npm publish, and only reuses a leftover `release/v…` branch when none of those exist.
