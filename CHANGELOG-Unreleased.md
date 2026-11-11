### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

- Docs and examples: the setup guide's adapter now sets `storeWholeNumbersAsIntegers: true`, recommended for new apps, with a note to check raw SQL first (Performance guide) when adding it to an existing app; the migration guide from WatermelonDB recommends it as a step after that check. The library default doesn't change. NotesApp (and NotesApp_windows, which shares its database setup), the TypeScript example and the NitromelonDB benchmark app turn it on, so e2e tests and the benchmarks run the recommended configuration.

### Internal

- Performance page: the iOS benchmark's absolute times are adjusted for each CI machine's speed by default, measured by WatermelonDB 0.28 in the same job (it never changes and runs in the same simulator), with a toggle back to raw times. On the recorded runs this halves the run-to-run variation of the 50k sync and fetch charts, so a slower CI machine no longer looks like a regression. The host-side runner baseline (`scripts/runner-baseline.mjs`) isn't used for this: it runs in Node outside the simulator, and adjusting by it made the variation larger. Its chart is replaced by the machine factor.

- CI: NotesApp's iOS and Android e2e builds run in their own jobs (`NotesApp iOS (build)`, `NotesApp Android (build)`) and pass the Release app to the jobs that test it as an artifact: `NotesApp iOS (Maestro)`, `NotesApp Android (Maestro)` and the flashlight perf run, now its own job (`NotesApp Android (flashlight)`). A flaky flow or perf run re-runs only its own job instead of the build too, and the Android e2e and flashlight runs no longer wait for each other.
- iOS CI: the native tests and the NotesApp / benchmark e2e jobs pick an available iPhone simulator on the newest iOS runtime (`scripts/pick-ios-simulator.sh`), and wait up to 3 minutes for one to show up, instead of asking for `iPhone 17` by name (a run failed with no simulator matching it). The `pagination-seed` flow gives its scroll to the last note 90 s instead of 25 s: each failed lookup before a swipe takes 6 to 8 s on a CI simulator, so 25 s allowed only four swipes.
