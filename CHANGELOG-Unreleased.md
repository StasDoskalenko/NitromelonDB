### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal

- CI: NotesApp's iOS and Android e2e builds run in their own jobs (`NotesApp iOS (build)`, `NotesApp Android (build)`) and pass the Release app to the jobs that test it as an artifact: `NotesApp iOS (Maestro)`, `NotesApp Android (Maestro)` and the flashlight perf run, now its own job (`NotesApp Android (flashlight)`). A flaky flow or perf run re-runs only its own job instead of the build too, and the Android e2e and flashlight runs no longer wait for each other.
- iOS CI: the native tests and the NotesApp / benchmark e2e jobs pick an available iPhone simulator on the newest iOS runtime (`scripts/pick-ios-simulator.sh`), and wait up to 3 minutes for one to show up, instead of asking for `iPhone 17` by name (a run failed with no simulator matching it). The `pagination-seed` flow gives its scroll to the last note 90 s instead of 25 s: each failed lookup before a swipe takes 6 to 8 s on a CI simulator, so 25 s allowed only four swipes.
