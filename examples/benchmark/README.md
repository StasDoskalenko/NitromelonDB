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

## Latest results (2026-11-07, iOS simulator)

NitromelonDB `master` ([`240f4cb7`](https://github.com/StasDoskalenko/NitromelonDB/commit/240f4cb7)) against WatermelonDB 0.28 with JSI and without JSI (`jsi: false`, the asynchronous bridge many apps still run).

- **Setup:** Release builds on an iPhone 18 Pro simulator (iOS 27.1, Xcode 27.1, React Native 0.88), on an Apple M5 Pro. Each WatermelonDB build's engine label ("JSI" / "asynchronous") was checked on screen before running.
- **Method:** [scripted runs](#scripted-runs), relaunching the app and clearing its database before every run. Two sessions, each with NitromelonDB in it: NitromelonDB against WatermelonDB JSI, then against WatermelonDB non-JSI. Runs within a session are interleaved in random order. Medians; p is a Mann-Whitney test.
- **Raw data:** [`results/2026-11-07-ios/`](./results/2026-11-07-ios). Re-summarize with `node scripts/summarize-sync.mjs <file> --baseline 'WatermelonDB JSI'` (or `'WatermelonDB non-JSI'`).

| Benchmark | NitromelonDB | WatermelonDB JSI | WatermelonDB non-JSI |
| --- | --- | --- | --- |
| **Realistic sync**: fresh install, 300 pulls, 80 tables (library time) | **524 ms** | 989 ms (**1.9× slower**, p<0.001) | 2,374 ms (**4.9× slower**, p<0.001) |
| **Incremental sync**: 67 pulls into 12 tables of 2,000 records | **184 ms** | 259 ms (**1.4× slower**, p<0.001) | 434 ms (**2.4× slower**, p<0.001) |
| **Sync, 5,000 records**: create, update, fetch, push (total) | **145 ms** | 174 ms (**1.2× slower**, p<0.001) | 254 ms (**1.8× slower**, p<0.001) |
| **Sync, 20,000 records** (total) | **650 ms** | 741 ms (**1.1× slower**, p<0.001) | 1,157 ms (**1.8× slower**, p<0.001) |
| **Sync, 50,000 records**: initial + update pulls (p<0.001 for each pull) | **1,503 ms** | 2,296 ms (**1.5× slower**) | 3,484 ms (**2.3× slower**) |
| **Sync, 50,000 records**: one fetch of all records | 2,402 ms | **193 ms** (12× faster) | **1,317 ms** (1.8× faster, p=0.56) |
| **Stress test**: 100,000 writes + deletes × 10 (ops/s) | **97,960** | 80,647 (**1.2× slower**) | 54,031 (**1.8× slower**) |

Each sync row is 8 runs per app, Incremental 10, and the stress test 3, where every NitromelonDB run beat every WatermelonDB run (p=0.081 is the smallest a 3-against-3 test can give). The NitromelonDB column is session 1; session 2 matched it within 7%.

**Where NitromelonDB is slower:**

- **One query that returns ~50,000 records at once.** The native query path (`queryJSI`, #140) builds every row object inside a single native call, and on the React Native 0.88 Hermes, garbage collection during that call gets expensive: about 2 s of the 2.4 s is GC. With the older `AnyMap` path forced, the same fetch takes 265 ms. 20,000 records (63 ms, 1.7× faster than WatermelonDB JSI) and the chunked reads sync does are unaffected. A fix is planned.
- **The stress test's query phase** (count, filtered fetch, paged queries) is 20% slower than WatermelonDB JSI (353 vs 295 ms), likely the same cause. Writes (−13%) and deletes (−27%) are faster.

Each app opens on a **Home** tile grid -- one tile per benchmark below -- instead of stacking
every card into a single long scroll. Tapping a tile opens that benchmark on its own screen with
a back button.

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
count). Each call is timed until it resolves (sync only), and again until the JS queue has drained
once more (`setImmediate`), so re-queries it triggers count towards it. Below that, the card
measures the pieces a sync is made of: an empty query, an empty `read()` / `write()` / `batch()`,
`getDeletedRecords()`, and one local storage read and write.

### Realistic sync

The "Realistic sync" card (`shared/realisticSyncBenchmark.ts`) is an initial sync of a fresh
install from a local mock server, the way a production app runs one: `fetch()` a page,
`JSON.parse` it, `synchronize()`, repeat until the server says it's done. It uses 80 tables with
4–23 columns each, and every response lists all of them, including the tables with no changes
(the shape reported in discussion #109). The server's changelog (`mock-server/server.mjs`) has:

- 10 pulls of initial data
- then mostly tiny pulls: ~35% empty, the rest touching 1–4 tables with 1–30 created, updated or
  deleted records each
- every 25th pull, one table dump of 500 records

The chips pick 100, 300 or 1,000 pulls.

The result splits wall time into **library** (inside `synchronize()`, minus network and parse),
**network**, **parse** and **open** (creating the fresh database), so a difference can be pinned
on the library or ruled out.

```sh
cd examples/benchmark
node mock-server/server.mjs            # port 8787
adb reverse tcp:8787 tcp:8787          # Android; the iOS simulator reaches localhost directly
```

Table shapes live in `mock-server/shape.mjs`. After changing them, run
`node mock-server/shape.mjs` to regenerate `shared/realisticSyncShape.json`, which the apps
import, then rebuild the apps. The apps allow cleartext HTTP
(`shared/plugins/withCleartextLocalhost.js`) because Android Release builds block it by default.

### Competing writers/readers

Both apps have the same "Competing writers/readers" card (`shared/competingWorkBenchmark.ts`).
It fires several independent writer/reader "callers" at the same `Database` at once -- a Light,
Heavy or Extreme preset -- none aware of the others, most left unnamed like a real
`database.write(fn)` call site would be. That's the shape that used to spam WorkQueue's dev-mode
"can't be performed yet" warning: several unrelated call sites (a periodic sync, a realtime push
handler, an on-screen query) all competing for the same Writer/Reader queue.

The card counts real warnings from the running library, not a simulated count -- it spies on
`console.warn` for the duration of the run (both libraries' `logger.warn()` call it internally,
so this works for either app without reaching into either library's private exports). The number
that matters here is **warnings**, not
wall time: a healthy queue produces few or none even under heavy contention; a stuck writer/reader
produces one warning naming itself, not one per thing waiting behind it.

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

`--card stress` runs the stress test at the top of the screen (`--sizes 100000` for Quick,
`1000000` for Full) and `--card mass` the mass-delete card (`--sizes` = records).

On Android, install Release APKs (`cd android && ./gradlew assembleRelease`, then
`adb install -r app/build/outputs/apk/release/app-release.apk`) and pass `--platform android` with
the adb serial as `--device`. `--card incr` drives the Incremental sync card instead, with
`--sizes` as records per table, and `--card real` the Realistic sync card, with `--sizes` as pull
counts:

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

#### Flashlight (Android)

`scripts/run-flashlight.mjs` drives the same cards under [Flashlight](https://github.com/bamlab/flashlight),
which samples CPU per thread, RAM and FPS from the device. Flashlight runs one app's iterations
back to back, so the script interleaves apps in rounds (`--per-round` iterations of each app per
round, in random order) and clears app data before every iteration:

```sh
node scripts/run-flashlight.mjs --device emulator-5554 --card incr --size 2000 \
  --apps 'NitromelonDB=com.nitromelondb.benchmark;WatermelonDB=com.watermelondb.benchmark' \
  --rounds 8 --per-round 4 --out-dir flashlight-incr
node scripts/summarize-sync.mjs flashlight-incr/summary.jsonl --baseline WatermelonDB
flashlight report flashlight-incr/nitromelondb.json flashlight-incr/watermelondb.json
```

The summary's main number is **CPU time**: CPU seconds used during the iteration, summed over
threads. Unlike mean CPU %, it doesn't change with how long the flow spends launching the app or
waiting around the benchmark itself.

### Timers on Android

React Native on Android runs `setTimeout` callbacks on the next display frame, so even
`setTimeout(fn, 0)` waits up to ~16ms. The Incremental sync card reports that latency
(`timerLatencyMs`) and times each pull without it. When timing small operations in your own app,
don't put a `setTimeout` inside the measured span.

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
