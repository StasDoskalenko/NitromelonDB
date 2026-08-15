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
- Publish Release uses `setup-node@v6` + Node 24 OIDC (`NODE_AUTH_TOKEN=""` on `npm publish`, no `registry-url`). Failed publishes can be retried from Actions → Publish Release.
- Package `author` is Stanislav Doskalenko.
