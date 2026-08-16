### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

- **`@json` sanitizers:** input and output types can differ (`(source: string) => string[]`). The previous `Sanitizer<T> = (source: T) => T` rejected real-world sanitizers and made wrapping `json()` fail.

### Performance

### Changes

### Internal
