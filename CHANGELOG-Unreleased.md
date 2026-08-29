### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal

- Replace the unmaintained `listr` / `listr-input` (used by the `release` and `android:emulator` scripts) with `listr2`. This drops the transitive `ansi-regex@3.0.0` (ReDoS — [GHSA-93q8-gq69-wqmw](https://github.com/advisories/GHSA-93q8-gq69-wqmw)) that Dependabot couldn't patch, along with a chain of other stale sub-dependencies. Dev tooling only; nothing changes for consumers.
