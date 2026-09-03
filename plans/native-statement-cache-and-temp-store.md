# Plan: bound the native prepared-statement cache; stop forcing Android `temp_store=memory`

Status: **Phase 1 and Phase 2 implemented** (D1 resolved: cap = 50). Phase 3
(parameterizing `encodeQuery`) remains a deliberate follow-up, not started.
Native integration tests and on-device benchmarks called for in Phases 1-2
below were not run -- this environment has no Xcode/Android SDK/NDK to build
or execute them; only local `yarn test`/typecheck were possible (unaffected,
since this is native-only).
Owner: TBD
Related: [#111](https://github.com/StasDoskalenko/NitromelonDB/issues/111) (issues 1 and 3 of 4 —
issue 2 is already fixed by #96 via a different mechanism; issue 4 is a documented tradeoff,
not addressed here). Same general theme as `plans/single-source-of-truth.md` and the `#96`
`WeakValueCache` work, but a different, independent pair of caches.

---

## 1. Goal

Two unrelated-but-adjacent native memory issues, both confirmed against this fork's actual
code (not just the upstream-flavored issue report, which cites file paths — `native/android-jsi/`,
`WatermelonJSI.java` — that don't exist here; this repo uses Nitro Modules instead):

1. **`Database::cachedStatements_`** (`native/shared/Database.h:95`) never evicts, and grows
   unbounded for the connection's lifetime — worse than #111 describes, once you trace where
   the SQL strings actually come from (§3).
2. **Android forces `pragma temp_store = memory`** unconditionally (`native/shared/Database.cpp:17-22`),
   which was a workaround for a different problem (missing temp directory) and has the side
   effect of moving sort/index-rebuild/migration scratch space from disk to heap — exactly
   the wrong tradeoff on a device already under memory pressure.

**Non-goals:** rewriting `encodeQuery` to use real parameterized placeholders throughout
(§3 explains why that's the *actual* root cause and a much bigger change — flagged as a
follow-up, not in scope here); anything about issue 4 (synchronous JSI/Nitro calls) — that's a
documented tradeoff, not a bug, and out of scope for this plan.

---

## 2. What we learned from #111

| Claim in #111 | Status here |
| --- | --- |
| `cachedStatements_` never evicts | **Confirmed**, exact code match. |
| Growth driven by `Q.oneOf`/`Q.notIn`'s varying `IN (?, ?, …)` arity | **Partially right, but understates it** — see §3. There are no `?` placeholders in `Collection#query()`'s encoded SQL at all for `where()` values; every distinct value produces a distinct cached statement, not just every distinct arity. |
| Android's trim-memory hook was a stub | Confirmed *was* true for this fork's equivalent (`platform::onMemoryAlert`) before #96; now implemented (differently — JS-side `WeakValueCache` pruning, not `sqlite3_db_release_memory`). Nothing further needed here. |
| `temp_store = memory` forced on Android | **Confirmed**, exact code and comment match. |
| Synchronous JSI blocks the JS thread | Confirmed, out of scope (documented tradeoff, per user decision this pass). |

---

## 3. Where the current code stands (facts)

### 3.1 The statement cache is keyed by full SQL text, and SQL text embeds literal values

`Database::prepareQuery` (`native/shared/Database-sqlite.cpp:14-34`) caches one `sqlite3_stmt*`
per **exact SQL string**, forever — cleared only in `Database::destroy()`
(`native/shared/Database.cpp:58-62`, which correctly `sqlite3_finalize`s each before clearing —
that's the pattern any eviction must reuse).

The actual growth driver is broader than #111's "varying `IN (...)` arity" diagnosis. Two
different SQL-construction paths exist in this codebase, with very different cache-key
cardinality:

- **Fixed-shape queries** (`find`, `getLocal`) use real `?` placeholders bound via
  `executeQuery(sql, args)`: `` "select * from `" + tableName + "` where id == ? limit 1" ``
  (`native/shared/Database-query.cpp:43`), `"select value from local_storage where key = ?"`
  (line 176). Cache-key cardinality here is bounded by table count — fine as-is.
- **`Collection#query()`'s dynamic `Q.where(...)` conditions** go through
  `src/adapters/sqlite/encodeQuery/index.ts`, which calls `encodeValue`
  (`src/adapters/sqlite/encodeValue/index.ts`) to turn **every** comparison value — not just
  `oneOf`/`notIn` lists — into an inline SQL literal (`encodeValues`/`getComparisonRight`,
  `encodeQuery/index.ts:26-37`), never a `?` placeholder. The file's own comment says as much:
  `// TODO: We shouldn't ever encode SQL values directly — use placeholders`
  (`encodeValue/index.ts:24`). This means **any** `Q.where('col', value)` with a different
  `value` produces a different full SQL string, hence a distinct, permanently-cached prepared
  statement — not just distinct `IN`-list arities. A hot query re-run with different filter
  values (pagination cursors, search terms, date ranges) grows this cache once per distinct
  value combination ever seen, for the life of the connection.

This reframes the fix: capping the cache (§4.1) is necessary regardless, but the *real* fix for
the growth rate is parameterizing `encodeQuery`'s literals — a substantially bigger change
(touches SQL generation, `bindArgs`, and the `simdjson`-based batch path) that's a natural
follow-up, not this plan's scope.

### 3.2 `temp_store = memory`'s origin and blast radius

`native/shared/Database.cpp:14-23`: on Android only, `pragma temp_store = memory` is set,
with a comment explaining it was added because large batches errored with "no temp store"
(`sqlite3_temp_directory` was never configured), and that leaving temp storage on disk "didn't
work." The consequence, per SQLite's own docs: `CREATE INDEX`, `ORDER BY`/`GROUP BY` over
unindexed columns, `VACUUM`, and any migration step that needs scratch space all allocate that
scratch space on the **heap** instead of spilling to a temp file — on the one platform
(Android) where `Database.cpp` also sets an 8 MB `sqlite3_soft_heap_limit`
(same file, matching AOSP's own `SQLiteGlobal` default) that this pragma actively works
against, since compiled scratch b-trees aren't the kind of memory that limit can reclaim
either.

### 3.3 The JNI pattern for getting a real temp path already exists

`native/android/src/main/java/com/nozbe/watermelondb/NativeDatabasePath.java` already does
almost exactly what's needed here: it holds a static `Context` set via `install(ctx)` (called
from `WatermelonDBPackage.createNativeModules`, per #96's research into this same file), and
C++ calls into it reflectively (`DatabasePlatformAndroid.cpp`'s `resolveDatabasePath`, via
`FindClass`/`GetStaticMethodID`/`CallStaticObjectMethod`). The same `Context` gives access to
`context.getCacheDir()` (an app-sandboxed, OS-manageable directory — exactly what
`sqlite3_temp_directory` wants), so no new Context-acquisition machinery is needed, only a new
static Java method (e.g. `NativeDatabasePath.getTempDirectory()`) and a new reflective call site
mirroring the existing `resolveDatabasePath` pattern.

---

## 4. Design

### 4.1 Bound `cachedStatements_` with an LRU cap

`Database.h`'s `cachedStatements_` becomes a small LRU (intrusive doubly-linked list + the
existing `unordered_map`, the standard C++ LRU shape — no new dependency needed) with a fixed
cap (a constant, not user-configurable in the first version — see D1). On eviction:
`sqlite3_finalize` the dropped statement before removing it from the map, mirroring exactly
what `destroy()` already does for the whole cache (`Database.cpp:58-62`) — reuse that
finalize-then-clear idiom, don't invent a new one.

**Safety property to preserve, learned from #96**: a statement currently *in use* (mid-`step()`,
or about to be `bindArgs`'d and executed by the same call that just fetched it from
`prepareQuery`) must never be evicted out from under that call. Since `prepareQuery` is called,
used, and (for repeat callers) reset entirely within one synchronous JSI/Nitro call on the JS
thread (per #111's own issue 4 — everything here is synchronous, no concurrent access), there's
no cross-call concurrency hazard the way there was with `RecordCache`'s cross-language
lifetime mismatch — eviction only needs to avoid removing the statement `prepareQuery` is about
to return *within the same call*, which a straightforward LRU (touch-on-access, evict only when
inserting past the cap) already guarantees, since the just-touched entry is always
most-recently-used.

### 4.2 Stop forcing `temp_store = memory` on Android

Per §3.3: add `NativeDatabasePath.getTempDirectory()` (Java) returning
`context.getCacheDir().getAbsolutePath()`, called reflectively from
`DatabasePlatformAndroid.cpp` the same way `resolveDatabasePath` is, and call
`sqlite3_temp_directory = <that path>` (a global SQLite C-API assignment, must happen before
opening any connection — same ordering constraint `initializeSqlite()`
(`native/android/src/main/cpp/DatabasePlatformAndroid.cpp:53-74`) already respects for other
global SQLite config) once, at `initializeSqlite()` time rather than per-connection. Drop the
`pragma temp_store = memory` line from `Database.cpp`'s Android branch once this lands.

---

## 5. Phases

### Phase 0 — Decisions and research
- [x] Resolve D1 (cache cap size) — **50**, chosen over the suggested 25 anchor for more
      headroom (user decision). D2 (parameterize `encodeQuery`) — deferred, tracked as Phase 3.
- [x] `sqlite3_temp_directory` lifetime — resolved by storing the JNI-obtained path in a
      function-static `std::string` (`androidTempDirectory` in `DatabasePlatformAndroid.cpp`),
      set once inside the existing `initializeSqlite()` `std::call_once` block, so the pointer
      SQLite holds stays valid for the life of the process, independent of the originating
      `jstring`/`Context` reference.

### Phase 1 — LRU cap on `cachedStatements_`
- [x] Implemented as `StatementCache` (`native/shared/Database.h`/`Database-sqlite.cpp`):
      `unordered_map` + intrusive `std::list` for O(1) touch/evict, reusing the
      `sqlite3_finalize`-on-drop idiom from `destroy()` (now `StatementCache::clear()`, called
      from `Database::destroy()`).
- [ ] Test (native integration test, since this needs a real `sqlite3_stmt*` lifecycle — not
      mockable in Jest): repeatedly query with >cap distinct SQL strings, assert cache size
      stays bounded and no crash/leak occurs; assert a statement still mid-flight within one
      call is never the one evicted. **Not run** — no native build toolchain in this
      environment; needs a follow-up pass with Xcode/Android SDK available.
- [ ] Benchmark: confirm no regression for the common case (a small, stable set of hot queries
      re-run often) — the whole point of caching prepared statements is to avoid re-parsing SQL
      on every call for exactly that case, and an LRU cap must not defeat it for normal usage.
      **Not run**, same reason.

### Phase 2 — Android `temp_store` fix
- [x] `NativeDatabasePath._getTempDirectory()` + JNI call site (`resolveTempDirectory()` in
      `DatabasePlatformAndroid.cpp`, mirroring `resolveDatabasePath`'s reflection pattern).
- [x] Set `sqlite3_temp_directory` once in `initializeSqlite()`.
- [x] `pragma temp_store = memory` is no longer unconditional — it now only runs when
      `platform::hasNativeTempDirectory()` reports the JNI resolution failed (revised after
      initial review: an unconditional drop was judged too risky without real-device
      verification of the JNI path, since a silent failure there would otherwise
      reintroduce the original "no temp store" IO error with no fallback at all).
- [ ] Test: the original bug this workaround fixed (large batches erroring with an IO error
      for lack of a temp store) must be re-verified as fixed by the real temp directory, not
      reintroduced — this needs a native/device-level test, not just Jest, given #96's lesson
      that this class of bug doesn't reproduce there. **Not run**, same environment limitation.
      The fallback pragma means a JNI resolution failure degrades to the old (known-safe,
      if heap-hungry) behavior instead of reintroducing the IO error, but the fallback
      trigger path itself (JNI failure detection) is still unverified on a real device.

### Phase 3 (follow-up, not this plan) — Parameterize `encodeQuery`
Tracked as a follow-up: replacing `encodeValue`'s literal-inlining with real `?` placeholders
in `Collection#query()`'s generated SQL would shrink the cache-key space dramatically (bounded
by *query shape*, not *query shape × every distinct value ever used*), which is the deeper fix
for what's actually driving `cachedStatements_`'s growth. Also closes the SQL-injection-style
footgun `encodeValue`'s own comment already flags. Bigger change (touches `bindArgs`, the
`simdjson`-based batch/sync paths, and likely the LokiJS/Node adapters' own query encoders for
consistency) — deliberately not bundled into this plan.

---

## 6. Testing

| Layer | What |
| --- | --- |
| Native integration tests (per-platform, not Jest) | LRU eviction correctness and `sqlite3_finalize` on drop; temp-store fix doesn't reintroduce the original large-batch IO error. |
| Benchmarks (`examples/benchmark` if present, or a native timing test) | Confirm the LRU cap doesn't regress the hot-query-reuse case the cache exists for. |
| Maestro | Given #96's repeated lesson this session — native-boundary bugs don't reproduce in Jest — a real on-device flow exercising a large/varied query workload should run before merge, not just unit-level coverage. |

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Evicting a statement still in use, crashing on next `step()`/`bindArgs()` | Per §4.1, everything is synchronous within one JS-thread call — no cross-call concurrency hazard like `RecordCache` had; still, test explicitly for the just-fetched-entry-is-always-MRU invariant. |
| LRU cap set too low, regressing the common hot-query-reuse case the cache exists for | Benchmark gate in Phase 1; cap should be generous (see D1), not aggressively small. |
| `sqlite3_temp_directory` set too late (after a connection already opened) is a documented SQLite no-op/misconfiguration | Set once in `initializeSqlite()`, which already runs once before any `Database`/connection is constructed (verified: `Database::Database()` calls it — see `native/shared/Database.cpp`/`native/android/.../DatabasePlatformAndroid.cpp`'s `initializeSqlite` `std::call_once` guard). |
| Removing `temp_store = memory` reintroduces the original "no temp store" IO error it was a workaround for | Explicit regression test in Phase 2, not just "the pragma is gone now." |

---

## 8. Decisions needed before Phase 1

- **D1.** LRU cap size — Android classic's `SQLiteDatabase` default (`maxSqlCacheSize = 25`,
  cited in #111) is a reasonable starting anchor, but this codebase's queries may have
  different reuse patterns than classic Android's. Needs a number, not left open-ended;
  suggest starting at 25 (matching the cited precedent) and revisiting if benchmarks show
  thrashing.
- **D2.** Does Phase 3 (parameterizing `encodeQuery`) get scheduled now as a committed
  follow-up, or left as a documented idea? Given §3.1's finding that it's the actual root cause
  of the cache's growth *rate* (not just its lack of a cap), worth a real decision rather than
  letting it languish — but it's a materially bigger, riskier change (touches SQL generation
  across adapters) than this plan's Phase 1/2, so deliberately kept separate either way.
