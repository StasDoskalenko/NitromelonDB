### Highlights

### BREAKING CHANGES

### Deprecations

### New features

- Documented **Observability**: nested-writer deadlocks, stuck reader/writer queue warnings, and routing logs into your APM.

### Fixes

### Performance

### Changes

- Docs site version badge tracks the npm package (including alpha/beta). It had stayed on `0.28.0` through the `0.30.0` prereleases.
- README and docs use the Nitromelon icon, link to full documentation right after the intro, and credit the original WatermelonDB.

### Internal

- Publish Release authenticates npm OIDC from a `push` to `master` (or manual dispatch). `pull_request_target` merge tokens are rejected by npm (`OIDC token exchange error - package not found`).
