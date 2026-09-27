### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

- The dev-mode "The writer/reader you're trying to run (unnamed) can't be performed yet..." warning is less noisy and more useful: a single slow writer/reader with several things queued behind it used to print one warning per queued item (each armed its own 1500ms timer); now there's one watchdog for whichever item is actually running, which warns at most once, naming itself. Undescribed `database.write(fn)`/`database.read(fn)` calls now fall back to the function's own name instead of always saying "unnamed", and `useWriter`/`useAtomicWriter` now pass a description too. Measured on a workload of 3 slow writers + 30 uncoordinated writer/reader callers: 3 warnings now vs 32 before (and 32 on upstream WatermelonDB) for the identical workload -- see the new "Competing writers/readers" card in `examples/benchmark`.

### Performance

- React Native: handoff between queued Writers/Readers now uses `setImmediate` instead of `setTimeout(fn, 0)`, avoiding a native-timer round-trip (~1 frame) between queued writes/reads.

### Changes

### Internal
