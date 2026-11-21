# examples/benchmark — NitromelonDB vs WatermelonDB stress apps

Two Expo development-build apps (`nitromelondb_benchmark/`, `watermelondb_benchmark/`) running the same loop from `shared/`. Methodology, latest results and scripted runs: `README.md` here.

- Change the loop in `shared/` so both apps keep running identical work. Do not fork it per app.
- The runner clears the JS identity cache after every write batch, so a million `Model`s do not stay on the heap. Query with `fetchCount` / `fetchIds` / `unsafeFetchRaw`, never `fetch()`: native SQLite still believes those IDs are cached and returns stubs the JS side no longer has.
- Use **Quick · 100,000 × 10** for day-to-day runs. The full 1,000,000 × 20 run takes hours and grows a large SQLite file.
- Results are only comparable on the same device with nothing else heavy running. Raw data lives in dated folders under `results/`; re-summarize with `node scripts/summarize-sync.mjs`.
