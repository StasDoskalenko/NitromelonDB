# Database benchmarks

Two Expo development-build apps that run the same stress test so NitromelonDB and upstream WatermelonDB can be compared on a real device.

Each **Start benchmark** run:

1. Resets the database
2. Writes **1,000,000** rows through `prepareCreate` + `batch`
3. Runs count, filtered fetch, and paged queries
4. Permanently deletes **1,000,000** rows through `prepareDestroyPermanently` + `batch`
5. Repeats that cycle **20** times

The score is **(writes + deletes) / second**. Wall time and per-round write / query / delete times are shown on the same screen.

Use **Quick · 100,000 × 10** for day-to-day comparisons. The full 1,000,000 × 20 path can take hours and will grow a large SQLite file. Work is chunked in batches of 2,500 so JS does not hold a million models at once.

These apps will not run in Expo Go. New Architecture is required.

## NitromelonDB

```sh
cd examples/benchmark/nitromelondb_benchmark
yarn
npx expo prebuild
npx expo run:ios
# or
npx expo run:android
```

Links the local library via `link:../../..`. After native SQLite / Nitro changes, rebuild.

### Mass delete: old vs new

Below the main comparison, the NitromelonDB app has an extra, self-contained card: "Mass delete:
old vs new". It seeds N rows twice into their own dedicated databases and times destroying all of
them once via the pre-optimization `Query#destroyAllPermanently()` (one `database.batch()` call --
one adapter transaction -- per matching record) and once via the current one (one
`destroyMatching()` call total, regardless of match count). It's NitromelonDB-only -- there's
nothing to compare against in the WatermelonDB app, since upstream never had `destroyMatching()`.
See `nitromelondb_benchmark/massDeleteBenchmark.ts`, and
`src/adapters/__tests__/sqliteTests/destroyAll.benchmark.js` (`yarn benchmark:destroy-all` at the
repo root) for the same comparison against Node/better-sqlite3.

## WatermelonDB

```sh
cd examples/benchmark/watermelondb_benchmark
yarn
npx expo prebuild
npx expo run:ios
# or
npx expo run:android
```

Uses `@nozbe/watermelondb@0.28.0` (the last upstream line this fork started from) with the JSI SQLite adapter. iOS needs the vendored `@nozbe/simdjson` pod (`expo-build-properties` `extraPods`); autolinking that package is disabled so CocoaPods does not see two simdjson sources.

## Comparing results

Run both apps on the **same device**, same workload chip, and no other heavy apps in the foreground. Record:

- **Score** (higher is better)
- **Total time** (lower is better)
- Write / query / delete breakdown
- Fastest vs slowest round (warmup and cache effects)

The shared runner lives in `shared/` so both apps execute the same loop, progress reporting, and scoring. After each write batch the JS identity cache is cleared so a million `Model` objects do not stay on the heap. Queries then use `fetchCount` / `unsafeFetchRaw` / `fetchIds` (not `fetch()`), because native SQLite still thinks those IDs are cached and would otherwise return stubs the JS side no longer has.
