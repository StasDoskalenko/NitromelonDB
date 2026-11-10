### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal

- iOS CI: the native tests and the NotesApp / benchmark e2e jobs pick an available iPhone simulator on the newest iOS runtime (`scripts/pick-ios-simulator.sh`), and wait up to 3 minutes for one to show up, instead of asking for `iPhone 17` by name (a run failed with no simulator matching it). The `pagination-seed` flow gives its scroll to the last note 90 s instead of 25 s: each failed lookup before a swipe takes 6 to 8 s on a CI simulator, so 25 s allowed only four swipes.
