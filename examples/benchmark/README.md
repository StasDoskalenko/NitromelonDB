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
`destroyMatching()` call total, regardless of match count). See
`nitromelondb_benchmark/massDeleteBenchmark.ts`, and
`src/adapters/__tests__/sqliteTests/destroyAll.benchmark.js` (`yarn benchmark:destroy-all` at the
repo root) for the same comparison against Node/better-sqlite3.

The WatermelonDB app has a matching "Mass delete (reference)" card -- upstream has no
`destroyMatching()` to compare against internally, so it just times its own
`Query#destroyAllPermanently()` at the same record counts. That number should land close to the
NitromelonDB card's "old" column (same algorithm); the NitromelonDB card's "new" column is the
improvement. See `watermelondb_benchmark/massDeleteBenchmark.ts`.

### Sync

Both apps have the same "Sync" card, driven by `shared/syncBenchmark.ts`. It runs the real
`synchronize()` against a 12-column table:

1. **Initial**: N records arrive as `created`, 2,000 per `synchronize()` call
2. **Update**: the same N records arrive again as `updated`. Sync reads every existing row back
   from SQLite first, so this is the phase most sensitive to native -> JS row conversion
3. **Fetch**: `query().fetch()` of all N records
4. **Push**: 1,000 local changes pushed and marked as synced

Every phase uses a fresh `Database` instance on the same file, so nothing is cached in JS between
phases, the same as a sync after an app restart. For comparable numbers, relaunch the app before
each run: the first large query after launch pays for Hermes heap growth, in both apps.

Under the table, the card shows the latest run's JS heap peak and GC count/time. These come from
Hermes' `HermesInternal.getInstrumentedStats()`, so no native code is involved. Heap size is
reported in whole heap segments, so small differences don't show up.

### Incremental sync

The "Incremental sync" card (`shared/incrementalSyncBenchmark.ts`) covers what the Sync card
doesn't: many small `synchronize()` calls into a database that already has data. It seeds 12
tables, then runs 67 calls in the size mix reported in discussion #109: 35 empty, 21 with 1–99
records, 5 with 100–999 and 6 with 1,000+. Every call pulls all 12 tables and has a
`pushChanges`, so it pays the fixed per-sync cost a real app does (reading and writing the
last-pulled timestamp, looking for local changes in each table). The sequence runs twice: with no
observers, then with 3 observed queries per table (a simple `where`, a sorted + limited list and a
count). Each call is timed until it resolves plus one macrotask, so re-queries it triggers count
towards it.

#### Scripted runs

To collect many runs and compare them, install a Release build of each app on a simulator
(`npx expo run:ios --configuration Release`), then:

```sh
cd examples/benchmark
node scripts/run-sync-trials.mjs --app com.nitromelondb.benchmark --label NitromelonDB \
  --sizes 5000,20000,50000 --runs 10 --device <simulator udid> --out results.jsonl
node scripts/run-sync-trials.mjs --app com.watermelondb.benchmark --label WatermelonDB \
  --sizes 5000,20000,50000 --runs 10 --device <simulator udid> --out results.jsonl
node scripts/summarize-sync.mjs results.jsonl
```

On Android, install Release APKs (`cd android && ./gradlew assembleRelease`, then
`adb install -r app/build/outputs/apk/release/app-release.apk`) and pass `--platform android` with
the adb serial as `--device`. `--card incr` drives the Incremental sync card instead, with
`--sizes` as records per table:

```sh
node scripts/run-sync-trials.mjs --platform android --device emulator-5554 --card incr \
  --apps 'NitromelonDB=com.nitromelondb.benchmark;WatermelonDB=com.watermelondb.benchmark' \
  --sizes 2000,10000 --runs 15 --out incremental.jsonl
node scripts/summarize-sync.mjs incremental.jsonl --baseline WatermelonDB
```

Android Release builds can't be `run-as`, so the runner clears the app's data (`pm clear`) before
each run instead of deleting just the database file, and reads RSS from `/proc/<pid>/status`.

Each run relaunches the app, drives the card with [Maestro](https://maestro.dev), and appends one
JSON line to `--out`. The runner also samples the app process's RSS from the host every 100ms,
which works because a simulator app is a normal macOS process. It approximates native memory use,
but it isn't the `phys_footprint` iOS uses for memory limits on a device. The summary prints the
median of each column, with min–max underneath.

## WatermelonDB

```sh
cd examples/benchmark/watermelondb_benchmark
yarn
npx expo prebuild
npx expo run:ios
# or
npx expo run:android
```

Uses `@nozbe/watermelondb@0.28.0` (the last upstream line this fork started from) with the JSI SQLite adapter. iOS needs the vendored `@nozbe/simdjson` pod (`expo-build-properties` `extraPods`); autolinking that package is disabled so CocoaPods does not see two simdjson sources. On Android the JSI adapter isn't autolinked; `plugins/withWatermelonJSIAndroid.js` adds the `watermelondb-jsi` Gradle project and registers its package on prebuild. Without it, `jsi: true` silently falls back to the bridge adapter. The engine line at the top of the screen shows which one runs.

## Comparing results

Run both apps on the **same device**, same workload chip, and no other heavy apps in the foreground. Record:

- **Score** (higher is better)
- **Total time** (lower is better)
- Write / query / delete breakdown
- Fastest vs slowest round (warmup and cache effects)

The shared runner lives in `shared/` so both apps execute the same loop, progress reporting, and scoring. After each write batch the JS identity cache is cleared so a million `Model` objects do not stay on the heap. Queries then use `fetchCount` / `unsafeFetchRaw` / `fetchIds` (not `fetch()`), because native SQLite still thinks those IDs are cached and would otherwise return stubs the JS side no longer has.
