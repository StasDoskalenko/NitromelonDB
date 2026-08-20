# Plan: expand end-to-end / on-device test coverage

Status: **Phases 0–2 mostly done. Phases 3–4 partial (adapter-level, not `Database`). Phase 5 L3 flows written, not CI-proven. Remaining: observers, true `deleteDatabaseFile` tests, Maestro CI, M11 upgrade.**
Owner: TBD
Scope: more migration, batch, concurrency and cleanup coverage running against **real
native SQLite** on iOS, Android and Windows — not just Jest with `better-sqlite3`.

---

## 0. Implemented vs remaining

Verified against the tree (not against earlier checkboxes).

### Done

| Item | Where |
| --- | --- |
| iOS XCTest wait **600s**, Cavy `waitTime` **30s** | `BridgeTests.swift`, `src/index.integrationTests.native.js` |
| L2 harness + modules wired into Jest (file) and native `integrationTest.js` | `src/adapters/__tests__/sqliteTests/` |
| M1, M2, M6 | `commonTests.js` |
| M3, M4, M5, M7, M8, M9, M10 | `sqliteTests/migrations.js` (M10 is a throwing step + reopen, not a process kill) |
| B1, B2, B3, B6 | `sqliteTests/batches.js` (10k / 5×2k) |
| B4, B5, B7, B8 | `commonTests.js` (B4 is mixed across 3 tables but **not** large; B7 is 100 rows, not thousands) |
| C1, C2, C4, C5, C6, C7 | `sqliteTests/concurrency.js` — **adapter `batch`/`find`**, not `Database.write` |
| D1, D7 | `sqliteTests/cleanup.js` — file-backed `unsafeResetDatabase` |
| D3 (adapter LocalStorage) | `sqliteTests/databaseLevel.js` via `setLocal`/`getLocal`, not `Database.localStorage` |
| D6 | same file — destroy + `testClone`, ID stays gone |
| `deleteDatabaseFile` + WAL/SHM unlink | **Android and Windows** native code |
| NotesApp schema v3 (`pinned` + used `sort_order`), `Q.take` pagination, `testID`s, Expo dev menu off | `examples/NotesApp/` |
| Maestro YAML: cold-start, add-pin-delete, kill-and-relaunch, C8, P1, P2 | `examples/NotesApp/maestro/` |

### Partial / weaker than the inventory

| Item | Reality |
| --- | --- |
| L2 on device is file-backed | Each case calls `createFileAdapter()` itself. The **outer** `integrationTest.js` adapter is still `mode=memory`. Harmless leftover, not the file under test. |
| C1–C3 “`Database` / writers / observers” | **No `new Database()`** in sqliteTests. `databaseLevel.js` is adapter LocalStorage + ID cache only. |
| C3 (`experimentalSubscribeWithColumns` while writes land) | **Not written.** |
| D2 (WAL/SHM after reset) | Reopen-and-write only. `assertSidecars()` exists but is **never called**. On device it is a no-op. |
| D4 (`ErrorAdapter`, subscriber warning) | Another adapter `unsafeResetDatabase`. Does not construct `Database` or hit those paths. |
| D5 (`deleteDatabaseFile`) | Test **skips Android/Windows** (stale comment: still “unimplemented”) and on iOS/node it calls **`unsafeResetDatabase`**, not `deleteDatabaseFile`. |
| Device cleanup | `cleanupDb()` / `assertDbExists()` only work on **node**. Device branch is empty. |
| iOS `deleteDatabaseFile` | Deletes the **main file only**. Android/Windows also unlink `-wal`/`-shm`. |
| Phase 0 “record wall times” | Timeouts were raised. **No numbers** are written down. |
| L3 Maestro | Flows exist and match current pagination. **Not** in GitHub Actions. **Not** recorded as passing on a simulator in this plan. |

### Not done

| Item | Notes |
| --- | --- |
| M11 | No v1 NotesApp artifact, no install-over-install Maestro flow |
| L3 CI workflow | No Maestro job under `.github/workflows/` |
| Native file-exists / sidecar hook (**D3**) | Still open |
| `Database.write` + observers on-device (original C1–C3 / D4 intent) | Still open |
| D1/D2 timeout **strategy** (per-case vs one global) | Global 600s only |
| Drop Jest `bail: true` (**D2**) | Still `true` in `jest.config.js` |
| Confirm C5–C7 flake-free on two CI runs | Not recorded |

---

## 1. Goal

Today the on-device suite is a single adapter-level spec list that runs almost entirely
against **in-memory** databases and never touches `Database`, writers, or observers. That
leaves the parts of NitromelonDB most likely to break on a real device — file-backed
databases, WAL sidecars, multi-hop migrations, large batches, interleaved reads and writes,
and database teardown — effectively untested outside of mocks.

The goal is to raise on-device coverage in four specific areas the maintainer called out:

1. **Migrations** — multiple sequential migrations, verifying each one actually applied
   (columns, indices, tables, `user_version`, data preserved), on a real file, across reopen.
2. **Batches** — large and mixed add/remove batches, transactional rollback, and the JS-side
   record-ID cache staying consistent with the database afterwards.
3. **Concurrency** — interleaved reads and writes, `Database.write` queueing under load,
   observers firing correctly while writes land, and two adapters on the same file.
4. **Database cleanup** — `unsafeResetDatabase` on a file-backed database, `-wal`/`-shm`
   sidecar handling, `deleteDatabaseFile`, and LocalStorage/observer state after teardown.

Non-goals: replacing Jest unit tests, adding a second reference app, sync-server e2e
(mock-backed sync tests in `src/sync/impl/__tests__/` stay as they are), and performance
benchmarking (that's `examples/benchmark`).

---

## 2. Where the tests stood **before this work**

Baseline that motivated the plan. Several bullets below are **stale as current truth** — see §0. They are kept so the original gaps stay readable.

### 2.1 One spec list, five consumers

`src/adapters/__tests__/commonTests.js` exports an array of `[name, testFn]` pairs. It is
consumed by:

| Consumer | Runner | Engine |
| --- | --- | --- |
| `src/adapters/sqlite/test.js` | Jest | `better-sqlite3`, in-memory |
| `src/adapters/lokijs/test.js` | Jest | LokiJS |
| `src/adapters/sqlite/integrationTest.js` → `src/__tests__/integrationTests.js` | Cavy | Nitro / native SQLite on iOS |
| same | Cavy | Nitro / native SQLite on Android |
| same | Cavy + WinAppDriver | Nitro / native SQLite on Windows |

So **one new case in `commonTests.js` runs in five places at once**. That is excellent
leverage and the main reason this plan is cheap — but it also means every case must either
work on LokiJS or be explicitly guarded (`AdapterClass.name === 'LokiJSAdapter'`), and
every case costs runtime on three device jobs.

### 2.2 How the native suite is driven

- `src/index.integrationTests.native.js` registers a Cavy `Tester` (`startDelay={500}`,
  `waitTime={30000}`) as the app root and reports through `BridgeTestReporter`.
- **iOS**: host app is `native/iosTest` (`WatermelonTester`), driven by XCTest
  (`native/iosTest/WatermelonTesterTests/BridgeTests.swift`) with a **600-second**
  `wait(for:timeout:)` (raised in Phase 0 from 100s).
- **Android**: host app is `native/androidTest`, driven by an instrumented test
  (`native/androidTest/.../BridgeTest.kt`) with a **5-minute** wait.
- **Windows**: host app is `examples/NotesApp_windows`, which swaps `index.js` for
  `index.integration.js` in CI and is driven by `@react-native-windows/automation`
  (`examples/NotesApp_windows/e2e/integration.test.js`, 180-second `waitUntil`).
- Cavy `waitTime` in `src/index.integrationTests.native.js` is **30s** (raised from 4s).

### 2.3 Almost everything runs in memory

`integrationTest.js` builds every adapter with
`file:testdb${Math.random()}?mode=memory&cache=shared`, and `SQLiteAdapter._getName`
defaults to the same shape under `NODE_ENV=test` (`src/adapters/sqlite/index.ts:136`).
Exactly one case — `can actually save and read from file system` — uses a real file.

Consequences: on-device tests never exercise WAL (`pragma journal_mode = WAL` is set only
for on-disk databases, `native/shared/Database.cpp:31`), never produce `-wal`/`-shm`
sidecars, and never test a database that survives the adapter that created it.

### 2.4 The native suite is adapter-level only

`src/__tests__/integrationTests.js` is `[SQLiteAdapterTest]`. Nothing above the adapter —
`Database`, `Collection`, `Model`, writers/readers, `Query`, observation — ever runs against
native SQLite. All of that is Jest-only, and much of it against `jest.fn()` adapter mocks
(e.g. `src/Model/test.js`, `src/Database/test.js`).

This is why "concurrent writes/reads" has essentially no on-device coverage: the real
concurrency surface is `Database._workQueue` + writer/reader blocks, which the native suite
never loads.

### 2.5 What migration coverage already exists

In `commonTests.js`:

- `migrates database between versions` (line 900) — v3 → v5, two applied migrations plus one
  out-of-range migration that must **not** run; checks default column values, new table
  usability, and that migrations don't re-apply after a `testClone`.
- `can perform empty migrations (regression test)` (1033) — version bump with no steps.
- `resets database when it's newer than app schema` (1055).
- `resets database when there are no available migrations` (1078).
- `errors when migration fails` (1101).

Genuinely missing: three-or-more sequential hops, the `unsafeExecuteSql` migration step,
indexed-column verification, `migrationEvents` (`onStart`/`onSuccess`/`onError`) firing,
`user_version` landing exactly, migrating a database with a non-trivial amount of data, and
any migration at all against a **file-backed** database (so no migration test currently
survives a real reopen on device).

### 2.6 What batch coverage already exists

`can run mixed batches` (488), `batches are transactional` (521), `can run sync-like flow`
(540), plus per-operation cases for create / update / markAsDeleted / destroyPermanently /
`getDeletedRecords` / `destroyDeletedRecords`.

Missing: anything **large**. `src/adapters/sqlite/encodeBatch/test.js:159` unit-tests an
index-recreation path that only triggers for large batches — that path is never executed
against real SQLite. Also missing: batches spanning many tables at once, deleting thousands
of rows, and whether the adapter's cached-ID set is still correct after a batch **rolls
back** (the transactional test checks row state, not cache state).

### 2.7 What concurrency and cleanup coverage already exists

- Concurrency: only `queues actions correctly` (740), which checks ordering of
  non-awaited adapter calls. `commonTests.js:869` uses `Promise.all`, but for unrelated
  table-name work. Nothing tests two adapters against one file, or reads during a long write.
- Cleanup: `can unsafely reset database` (731) in memory, and the reset inside `can actually
  save and read from file system` (1180). `Database.unsafeResetDatabase` teardown semantics
  (`_isBeingReset`, `ErrorAdapter` swap, subscriber detection) are tested only against a mock
  adapter in `src/Database/test.js:21`.
- `deleteDatabaseFile` is **unimplemented on Android** (`DatabasePlatformAndroid.cpp:130`,
  empty body with a TODO) and a **no-op on Windows** (`DatabasePlatformWindows.cpp:56`);
  only iOS implements it. Nothing anywhere deletes `-wal`/`-shm` sidecars. So "db cleanup"
  needs a small amount of native work before it can be tested at all — see Phase 4.

---

## 3. Design

### 3.1 Three layers, not one

| Layer | Vehicle | What belongs here | Cost |
| --- | --- | --- | --- |
| **L1 — adapter, cross-engine** | `commonTests.js` (existing) | Anything LokiJS can also satisfy: migration semantics, batch semantics, ordering. | ~free, runs 5× |
| **L2 — adapter + `Database`, SQLite-only** | **new** spec modules under `src/adapters/__tests__/` | File-backed databases, WAL/sidecars, large batches, writer/reader concurrency, reset/teardown, `Database`-level scenarios. | runs in Jest (node) + 3 device jobs |
| **L3 — app, black-box** | **new** Maestro flows against `examples/NotesApp` | Only what an in-process test cannot reach: cold start, real app-Documents database, kill-and-relaunch persistence, a genuine v1→v2 app upgrade. | expensive; own workflow, not per-PR |

The reason L2 is a new module rather than more `commonTests.js` cases: most of what's wanted
here is inexpressible or meaningless on LokiJS (files, WAL, transactions, native
concurrency), and stuffing it into `commonTests.js` would mean a growing thicket of
`if (AdapterClass.name === 'LokiJSAdapter') return` guards.

### 3.2 L2 file layout (and why it matters)

```
src/adapters/__tests__/
  commonTests.js            (existing, unchanged shape)
  sqliteTests/
    index.js                aggregates and exports [name, fn][] like commonTests
    migrations.js
    batches.js
    concurrency.js
    cleanup.js
    databaseLevel.js        Database/writer/observer scenarios
    helpers.js              file-db naming, temp dir, reopen, sidecar assertions
```

Placing these under a `__tests__/` directory is deliberate, not cosmetic:

- `scripts/source-files.mjs` excludes `/__tests__/` from the published package, so none of
  this ships to npm.
- `.eslintrc.js` excludes `**/__tests__/**` from the "implementation files under `src/` must
  be TypeScript" rule, so `.js` spec files are allowed without touching lint config.
- Jest's `testMatch` (`**/__tests__/**/?(spec|test).js`) will **not** pick these up directly,
  which is what we want — they're consumed by `src/adapters/sqlite/test.js`, not run alone.

Consumers to update:

- `src/adapters/sqlite/test.js` — append `sqliteTests()` to the `commonTests()` loop (Node).
- `src/adapters/sqlite/integrationTest.js` — same, for the native suite.
- `src/adapters/lokijs/test.js` — untouched.

### 3.3 A real-file harness for L2

Nearly every gap in §2 traces back to in-memory databases. L2 needs a small harness:

- `fileDbName(platform)` — `.tmp/<name>.db` on node, a bare `<name>.db` on device (resolved
  by `platform::resolveDatabasePath` into Documents / LocalFolder).
- `reopen(adapter, options)` — a thin wrapper over `testClone`, which already constructs a
  fresh `SQLiteAdapter` on the same `dbName` and awaits `_initPromise`
  (`src/adapters/sqlite/index.ts:120`). This is our "restart" primitive; it is *not* a
  process restart (that's L3), but it does re-run `initialize()` and the migration path
  against a real file.
- `cleanupDb(dbName)` — deletes the database and its `-wal`/`-shm` sidecars after each case,
  so device storage doesn't accumulate. Needs a native path (Phase 4).
- Sidecar assertions — presence/absence of `<db>-wal` and `<db>-shm`. On node this is `fs`;
  on device it needs a tiny file-existence hook. **Decision D3** covers whether to add one
  or infer sidecar behavior indirectly.

Each L2 case must use a unique database name and clean up after itself; the suite runs
repeatedly on the same simulator/emulator.

### 3.4 Concurrency: what is actually testable

Worth being precise, because "concurrent" means two different things here:

- **Nitro calls are synchronous on the JS thread** (`src/nitro/Nitromelon.nitro.ts`). Two JS
  callers cannot be inside the adapter at the same time. So "concurrency" at the JS level
  means **interleaving and ordering**: non-awaited calls, `Promise.all` over writers, reads
  issued while a writer block is mid-flight, observers emitting between batches.
- **True parallelism** requires two connections to the same file — two `SQLiteAdapter`
  instances (already possible, see `commonTests.js:1169`) or a second process (L3). This is
  where `SQLITE_BUSY` and WAL behavior become observable, and where
  `begin exclusive transaction` (`native/shared/Database-sqlite.cpp:328`) and the
  `usesExclusiveLocking` option (`src/adapters/sqlite/type.ts:31`) matter.

Both are worth covering, but they're different tests with different assertions, and the
second is the one that can plausibly flake. Multi-connection cases should assert *no
corruption and no lost writes*, not specific interleavings.

### 3.5 Reusing the Notes apps

The maintainer's instinct is half already true:

- **Windows already reuses `NotesApp_windows`** as the Cavy host (`index.integration.js`).
- **iOS and Android do not** — they use the dedicated `native/iosTest` / `native/androidTest`
  harness apps, which exist precisely so the suite can be driven by XCTest / instrumented
  tests and report natively through `BridgeTestReporter`.

**Recommendation: do not move the L1/L2 suite into `NotesApp`.** The harness apps already
work, are wired into CI, and give native pass/fail reporting; porting to Expo would mean
re-solving reporting for no coverage gain.

**But do add `NotesApp` as the L3 host**, because there are three things no in-process test
can reach:

1. **Cold start** — `SQLiteAdapter` constructed at module scope with a real
   Documents-directory database, on a fresh install.
2. **Kill and relaunch** — data still there, `user_version` unchanged, no re-migration.
3. **A genuine app upgrade** — install a build pinned to schema v1, add notes, install the v2
   build over it, assert the `pinned` column migration ran and the notes survived. This is
   the single most user-visible failure mode NitromelonDB has, and nothing tests it today.

`NotesApp` is the L3 host: schema **v3** (v1→v2 `pinned`, v2→v3 `sort_order`), create / pin /
delete, `Q.take` pagination (Load more widens the window; it must **not** insert rows),
`testID`s, and the Expo dev menu disabled on launch so Maestro can tap the UI.

Maestro is the driver (YAML flows, Expo dev builds, iOS simulator and Android emulator).
Run from `examples/NotesApp` only (`maestro test maestro/`). Detox is the unused
alternative (**D5**).

---

## 4. Test inventory

The concrete cases. Status is **Done / Partial / Not done** as of the tree in §0.

`L1` = `commonTests.js`, `L2` = `sqliteTests/`, `L3` = Maestro against `NotesApp`.

### 4.1 Migrations

| # | Case | Layer | Status |
| --- | --- | --- | --- |
| M1 | Three sequential hops v1→v2→v3→v4 in one launch | L1 | **Done** |
| M2 | Same, one version per `reopen`/`testClone` | L1 | **Done** |
| M3 | File-backed migration, reopen twice, data preserved | L2 | **Done** |
| M4 | `unsafeExecuteSql` step in a real migration | L2 | **Done** |
| M5 | `addColumns` + `isIndexed: true`, index in `sqlite_master` | L2 | **Done** |
| M6 | `createTable` then write/query then reopen | L1 | **Done** (also duplicated in L2 migrations.js) |
| M7 | `migrationEvents.onStart` / `onSuccess` | L2 | **Done** |
| M8 | `migrationEvents.onError` when a step fails | L2 | **Done** |
| M9 | ~10k rows preserved across migration | L2 | **Done** (one table, not two) |
| M10 | Interrupted migration not half-applied | L2 | **Partial** — throwing step + reopen, not a process kill |
| M11 | App upgrade v1 build → current on device | L3 | **Not done** |

M10 is the highest-value case here and may fail on first write — `setUpWithMigrations`
transactionality across steps is exactly the kind of thing that's assumed rather than
verified. If it does fail, that's a bug found, not a test to weaken.

### 4.2 Batches

| # | Case | Layer | Status |
| --- | --- | --- | --- |
| B1 | Large create batch (10k), findable after reopen | L2 | **Done** |
| B2 | Large batch / index-recreation path | L2 | **Partial** — large mixed batch; does not assert `sqlite_master` indices |
| B3 | Large delete batch (10k `destroyPermanently`) | L2 | **Done** |
| B4 | Mixed batch across ≥3 tables | L1 | **Partial** — mixed ops, small row counts (not “large”) |
| B5 | Rollback leaves JS ID cache consistent | L1 | **Done** (skipped/weaker on LokiJS) |
| B6 | Sequential 5 × 2k batches | L2 | **Done** |
| B7 | `markAsDeleted` → `getDeletedRecords` → `destroyDeletedRecords` | L1 | **Partial** — 100 rows, not thousands |
| B8 | Empty / no-op batch | L1 | **Done** |

### 4.3 Concurrency

| # | Case | Layer | Status |
| --- | --- | --- | --- |
| C1 | `Promise.all` of N writes, final count exact | L2 | **Partial** — `adapter.batch`, not `database.write` |
| C2 | Reads during a write see committed data | L2 | **Partial** — adapter queue, not `Database._workQueue` |
| C3 | `experimentalSubscribeWithColumns` while writes land | L2 | **Not done** |
| C4 | Interleaved non-awaited batch/find/query | L2 | **Done** (adapter-level, file-backed) |
| C5 | Two adapters, one file, both writing | L2 | **Done** (adapter-level) |
| C6 | Two adapters, long write + read, no torn data | L2 | **Done** (adapter-level) |
| C7 | C5 with `usesExclusiveLocking: true` | L2 | **Done** (adapter-level) |
| C8 | NotesApp rapid add / pin / delete | L3 | **Written** — YAML only, not CI-proven |
| P1 | Seed 100, `Q.take` pages, count stays 100 | L3 | **Written** — YAML only, not CI-proven |
| P2 | Dynamic adds; Load more does not insert | L3 | **Written** — YAML only, not CI-proven |

C5–C7 are the flake risk. Mitigation: assert invariants (no corruption, no lost rows) rather
than orderings, keep the row counts modest, and if a case proves unstable on one platform,
gate it per-platform with a comment rather than deleting it.

### 4.4 Database cleanup

| # | Case | Layer | Status |
| --- | --- | --- | --- |
| D1 | `unsafeResetDatabase` on a file, empty + writable after reopen | L2 | **Done** |
| D2 | WAL/SHM sane after reset, file not growing | L2 | **Partial** — reopen works; sidecars not asserted |
| D3 | LocalStorage cleared by reset | L1 intended | **Partial** — L2 adapter `setLocal`, not `Database.localStorage` |
| D4 | `Database.unsafeResetDatabase` on native (ErrorAdapter, subscribers) | L2 | **Partial** — adapter reset only |
| D5 | `deleteDatabaseFile` removes db + sidecars | L2 | **Not done** — skip on Android/Windows; iOS/node uses reset not delete; iOS native still omits sidecar unlink |
| D6 | Reopen after delete does not resurrect cached IDs | L2 | **Done** |
| D7 | 20× create-write-reset, no handle leak smoke | L2 | **Done** (smoke only; does not measure handles) |

---

## 5. Phases

Each phase independently mergeable, with a `CHANGELOG-Unreleased.md` entry (Internal
section) and green `yarn ci:check`.

### Phase 0 — Headroom and harness (do this first)

The iOS XCTest timeout was 100s; Phase 0 raised it to 600s. Keep an eye on wall time if
L2 grows further.

- [x] Raise the XCTest timeout in `native/iosTest/WatermelonTesterTests/BridgeTests.swift`
      from 100s to 600s, and Cavy `waitTime` from 4s to 30s.
- [ ] Record actual native-suite wall times on iOS / Android / Windows (the “measure” item
      was marked done without numbers).
- [ ] Decide the per-case timeout story (**D1**): a global bump, or per-case `waitTime`.
- [x] Add `src/adapters/__tests__/sqliteTests/` with `index.js` + `helpers.js` and wire it
      into `src/adapters/sqlite/test.js` and `src/adapters/sqlite/integrationTest.js`.
- [x] File-database harness: unique names, temp/Documents resolution, `reopen`, cleanup.

### Phase 1 — Migrations

- [x] M1, M2, M6 in `commonTests.js`.
- [x] M3, M4, M5, M7, M8, M9 in `sqliteTests/migrations.js`.
- [x] M10 (interrupted migration). If it exposes a real transactionality gap, split the fix
      into its own commit.
- [x] Extend `examples/NotesApp` to schema v3 (`sort_order`) with a second migration (**D4**)
      and actually use that column in the list query (`Q.sortBy('sort_order', Q.desc)`).

### Phase 2 — Batches

- [x] B4, B5, B7, B8 in `commonTests.js`.
- [x] B1, B2, B3, B6 in `sqliteTests/batches.js`, with row counts tuned to the Phase 0
      time budget (start at 10k; drop if a device job gets slow).

### Phase 3 — Concurrency and `Database`-level coverage

- [x] Adapter-level C1, C2, C4, C5, C6, C7 in `sqliteTests/concurrency.js` (file-backed
      `batch` / two adapters).
- [ ] Construct a real `Database` + models in `databaseLevel.js` (file comment claims this;
      the file only tests adapter LocalStorage and cached IDs).
- [ ] C1–C2 as specified: `database.write` / `_workQueue`, not only `adapter.batch`.
- [ ] C3: `experimentalSubscribeWithColumns` while concurrent writes land.
- [ ] Watch C5–C7 for flakes across two full native CI runs.

### Phase 4 — Cleanup, and the native work it needs

- [x] Implement `deleteDatabaseFile` + `-wal`/`-shm` unlink on **Android** and **Windows**.
- [ ] iOS `deleteDatabaseFile` still removes only the main file — add sidecar unlink to match.
- [ ] Call `deleteDatabaseFile` in D5 (today: `unsafeResetDatabase`). Stop skipping Android/Windows.
- [ ] `cleanupDb` / `assertDbExists` / `assertSidecars` on device (today: node-only).
- [ ] Native file-exists hook or honest pragma-based sidecar asserts (**D3**).
- [x] D1, D7 file-backed reset smoke.
- [ ] D2 sidecar assertions; D4 `Database` + ErrorAdapter / subscriber warning.
- [x] D3 adapter `setLocal` cleared on reset; D6 stale ID after destroy + clone.

Note the overlap with `plans/database-encryption.md` §4.4 / Phase 3, which needs the same
`deleteDatabaseFile` and sidecar work.

### Phase 5 — L3: `NotesApp` black-box flows

Contract for pagination flows (easy to get wrong):

- Seed **100** notes. Newest on screen is `Note #100` (`sort_order` descending).
- List query is `Q.take(page * 20)` plus sorts. **Load more only increments `page`.**
- `experimentalSubscribeToCount` drives the subtitle. Load more must **not** change the count.
- Query operators are `Q.skip` / `Q.take`, never `Q.limit`.
- Unsubscribe every subscription. Do not subscribe to the full list and a page at the same time.
- Disable the Expo dev menu / FAB / onboarding overlay (`showMenuAtLaunch: false`) or Maestro
  will tap the overlay instead of the app.
- Always `cd examples/NotesApp` before `maestro test`. Reuse Metro on port 8081 if it is already up.

- [x] `testID`s, schema v3 `sort_order` used in the query, Load more = `Q.take` only.
- [x] YAML in `examples/NotesApp/maestro/` for cold-start, add-pin-delete, kill-and-relaunch,
      C8, P1, P2.
- [ ] Run those six flows on a booted simulator after rebuild; record pass/fail here.
- [ ] M11: v1-schema build artifact, install, seed, install current schema over it.
- [ ] Nightly / `workflow_dispatch` GitHub Actions workflow (not per-PR `ci.yml`).

---

## 6. CI impact

| Job | Today | Expected after | Notes |
| --- | --- | --- | --- |
| `ci-check` (Jest) | fast | +L2 cases against `better-sqlite3` | `jest.config.js` has `bail: true`; with a much larger suite, consider dropping it so one failure doesn't hide the rest (**D2**) |
| `ios` | XCTest wait **600s** | watch wall time as L2 grows | Phase 0 done; original 100s cap is gone |
| `android` | 5-min wait | likely fine | slowest device, largest headroom already |
| `windows` | 180s `waitUntil`, 90-min job | may need a higher `waitUntil` | `examples/NotesApp_windows/e2e/integration.test.js` |
| new L3 workflow | **missing** | own workflow | not per-PR; Maestro YAML is local-only today |

If the native suite outgrows its budget even after Phase 0, shard it: `integrationTests.js`
already takes an array of spec functions, so splitting into "core" (per-PR) and "extended"
(nightly) is a small change to that file plus an env flag.

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| iOS 100s XCTest timeout turns new tests into red CI | Phase 0 raised it to 600s; re-measure if L2 grows |
| Multi-connection cases (C5–C7) flake on one platform | Assert invariants not orderings; modest row counts; per-platform gating with a comment over deletion |
| Large-batch cases (B1–B3, M9) slow every device job | Tune sizes against Phase 0 measurements; shard if needed |
| Device storage fills up from file-backed tests | Mandatory per-case cleanup incl. sidecars; unique names |
| New cases in `commonTests.js` break the LokiJS suite | Only genuinely engine-agnostic cases go to L1; everything else to L2 |
| Adding `Database`-level tests to the native bundle pulls in more of `src` and may hit Metro config in `NotesApp_windows` | `metro.config.js` there already whitelists integration-test deps; extend it in the same commit and verify the Windows job |
| L3 upgrade test is fiddly and could rot | Keep it out of the per-PR path; if it can't be made reliable, keep M3's `reopen` coverage and document the gap |
| Duplicate native file-handling work with the encryption plan | Coordinate: land `deleteDatabaseFile` + sidecars once, in whichever plan moves first |

---

## 8. Decisions needed

- **D1.** Timeout strategy for the native suite: one generous global timeout, or per-case
  `waitTime` for the slow cases? Related: do we shard into core/extended now or wait until
  it hurts?
- **D2.** Drop `bail: true` from `jest.config.js` so a large suite reports all failures in
  one run?
- **D3.** How do sidecar assertions work on device? Add a tiny native file-exists hook, or
  infer WAL behavior indirectly (e.g. via `pragma journal_mode` and `wal_checkpoint`)?
  Indirect is cheaper and needs no native API; a hook is more honest about what's on disk.
- **D4.** How do we get a schema-v1 `NotesApp` build for the upgrade test — a build-time env
  flag that selects v1 schema + no migrations, a checked-in second app variant, or a
  pre-built artifact? The reference app is already on schema v3 (`pinned` + `sort_order`).
  Remaining work is only the old-build artifact for M11.
- **D5.** L3 driver: **Maestro chosen** (YAML in-repo). Detox not used. Remaining: run locally
  and add CI.
- **D6.** Do the concurrency cases need a deterministic scheduler/barrier helper (something
  like `src/__tests__/utils/makeScheduler.js`) to be reliable on device, or is
  `Promise.all` + invariant assertions enough? Current C1–C7 use `Promise.all` only.

---

## 9. Open questions

- Should the native suite run a real `Database` at all (Phase 3), or is that scope creep for
  an "adapter integration" suite? **Still unanswered — and still not done.** Writers, observers
  and the work queue remain Jest/mock-only aside from NotesApp (L3).
- Is there value in an on-device sync round-trip against a fake in-process backend? It would
  cover `unsafeLoadFromSync` and migration syncs on real SQLite, which today are mock-only —
  but it's a large addition and arguably its own plan.
- Should `examples/benchmark` and the large-batch cases share size constants, so a
  performance regression shows up in both places consistently?
