### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

- The dev-mode "The writer/reader you're trying to run (unnamed) can't be performed yet..." warning is less noisy and more useful: a single slow writer/reader with several things queued behind it used to print one warning per queued item (each armed its own 1500ms timer); now it warns at most once per running writer/reader, naming it, once something has been waiting behind it for 1500ms -- including when it only gets stuck late (e.g. a nested `write()` without `callWriter()` after a slow `await`). Undescribed `database.write(fn)`/`database.read(fn)` calls now fall back to the function's own name, then (dev only) to the name of the function that called `write()`/`read()`, instead of always saying "unnamed"; `useWriter`/`useAtomicWriter` now pass a description too. Measured on a workload of 3 slow writers + 30 uncoordinated writer/reader callers: 3 warnings now vs 32 before (and 32 on upstream WatermelonDB) for the identical workload -- see the new "Competing writers/readers" card in `examples/benchmark`.

### Performance

### Changes

### Internal
