# Plan: Single source of truth — detecting external SQLite changes

Status: **proposal / not started**
Owner: TBD
Related in this repo: #96 (the `WeakValueCache`/`RecordCache` incident that surfaced this),
#97 (native low-memory wiring, folded into the same branch as this plan)
Related upstream: [Nozbe/WatermelonDB#1295](https://github.com/Nozbe/WatermelonDB/issues/1295),
[#1605](https://github.com/Nozbe/WatermelonDB/issues/1605),
[#1675](https://github.com/Nozbe/WatermelonDB/issues/1675)

---

## 1. Goal

Close the gap where changes made *outside* `Database.batch()`'s own JS-side bookkeeping are
invisible to subscribers, `RecordCache`, and the adapter's own "already sent to JS" id
tracking — until something unrelated happens to force a full resync. Two sources of such
changes, addressed below as two distinct mechanisms:

1. A different SQLite connection or process writing to the same file — the exact scenario in
   Nozbe/WatermelonDB#1295 (an iOS Notification/Share Extension writing via its own
   `FMDatabase` handle).
2. Raw SQL run through *our own* connection but outside `Database.batch()` — e.g.
   `unsafeExecuteMultiple` — which bypasses the JS change-tracking even though it's the same
   process.

**Non-goals:** row-level diff granularity for external changes from day one (Phase 1 is
intentionally coarse); LokiJS/web's multi-tab consistency (a different mechanism entirely —
no shared file, no second SQLite connection — possibly a follow-up plan, not this one);
replacing or overlapping with the existing sync engine (`src/sync`) — this is about one
physical database file possibly having more than one writer, not client-server sync.

---

## 2. What we learned

| Source | Problem | Lesson for this plan |
| --- | --- | --- |
| Nozbe/WatermelonDB#1295 | External process writes directly to the SQLite file (extension using `FMDatabase`); main app's subscriptions never fire, `query().fetch()` keeps returning stale cached data, even after reopening the app. | This is a **cross-connection** problem — nothing short of polling `PRAGMA data_version` or OS-level file watching can see it. No in-process hook fixes it. |
| Nozbe/WatermelonDB#1605 | "Record ID ... was sent over the bridge, but it's not cached" — the exact error class we hit in #96, but reported upstream with **no weak-caching involved at all**. | The adapter/JS cache-id contract is fragile even in the *original*, all-strong-references design — external interference (of any kind) can desync it. Whatever we build must actively reconcile both sides together (§5.2), not just detect drift. |
| Nozbe/WatermelonDB#1675 | 200+ "is cached, but full raw object was sent over the bridge" warnings during mass delete+recreate batches — same-process, same-connection, but the two caches (adapter id set, JS `RecordCache`) still drift under heavy churn. | Even the **in-process** id-tracking pair needs a more robust reconciliation path than "reset one side and hope," which is all `_clearCachedRecords()` does today. |
| This repo, #96 | Making `RecordCache` a `WeakValueCache` broke real device/CI runs, because the adapter's own id set assumes `RecordCache` never independently drops an entry. | Any fix here must treat the adapter-side id set and `RecordCache` as **one logical cache with two physical halves**, always updated together — never "detect a change, clear the JS side" without also resetting the adapter side, or vice versa. |

---

## 3. Two distinct gaps, two distinct mechanisms

The important thing to get right conceptually, so the flag doesn't overpromise: SQLite's
`sqlite3_update_hook` / `sqlite3_wal_hook` only fire for writes made **through the connection
that registered them** — they do not see another connection's or another process's writes.
Verified nothing in `native/` uses either today (`grep -rn "update_hook\|wal_hook\|data_version" native/` — no hits), so this is genuinely new territory, not a partially-built feature like the memory-warning stubs were.

- **Gap A — same connection, bypasses our own bookkeeping.** `unsafeExecuteMultiple`
  (`native/shared/DatabaseBridge.cpp:197`, declared in `Database.h`) and any other raw-SQL
  write path run straight against the C++ `Database` object, never touching
  `Database.batch()`'s `changeNotifications` computation (`src/Database/index.ts:480-513`).
  `sqlite3_update_hook` on our own connection is the right fix: cheap, push-based (not
  polled), and always correct, because it's the same connection.
- **Gap B — a different connection or process entirely** (upstream #1295's scenario). No
  SQLite hook crosses connections. The standard mechanism is **`PRAGMA data_version`** — an
  integer that increments whenever *any* connection commits a change to the database file,
  safe and cheap to poll (`SELECT`, no write, no lock contention). There is no push equivalent
  without OS-level file watching (inotify / FSEvents / `ReadDirectoryChangesW` on the
  `-wal`/`-shm` files), which is heavier, deeply platform-specific, and out of scope for a
  first version.

---

## 4. Where the current code stands (facts)

- **Both real adapters already run a parallel "already sent to JS" id-tracking scheme** that
  any fix here must coordinate with, not fight:
  - LokiJS: `cachedRecords: Map<TableName, Set<RecordId>>`
    (`src/adapters/lokijs/worker/DatabaseDriver.ts:48`), reset via `clearCachedRecords()`.
  - SQLite/Nitro (previously undocumented in this repo's JS-side comments — same shape, C++
    side): `std::unordered_set<std::string> cachedRecords_` (`native/shared/Database.h:96`),
    with `hasCachedRecord`/`addCachedRecord`/`removeCachedRecord`/reset
    (`native/shared/Database.cpp:71-100`).
- **All reactivity today is 100% JS-driven.** `Database.batch()` computes
  `changeNotifications` purely from the operations *it* issued, applies them to each
  `Collection`'s `RecordCache` via `_applyChangesToCache()`, then calls `_notify()` which
  fires table-scoped subscribers (`src/Database/index.ts:480-543`). None of this is aware of
  the SQLite file's actual state — it's a record of "what did *we* just tell the adapter to
  do," nothing more.
- **`RecordCache`** (`src/Collection/RecordCache.ts`) — a plain, strongly-referencing `Map`
  since #96, deliberately, because it mirrors the adapter-side id set(s) above and must never
  drop an entry those still believe is cached. Any external-change detector must reset (or
  transactionally update) the adapter-side id set *and* reconcile `RecordCache` together — see
  §5.2 — never one without the other.
- **WAL mode is already the default** (`native/shared/Database.cpp:31`,
  `pragma journal_mode = WAL`), which is what makes safe concurrent access from another
  connection possible in the first place. `usesExclusiveLocking` (same file, lines 43-46) is
  the opt-out, and its own comment — "this seems to fix the headless JS service issue but
  breaks if you have multiple readers" — confirms multi-connection access is already an
  intentionally supported SQLite-level configuration; WatermelonDB's reactive layer just
  doesn't know how to respond to it.
- **`Database#unsafeResetDatabase()`** and `SharedSubscribable#invalidate()` /
  `KeyedSharedSubscribable#invalidate()` already implement the closest analog to "something
  changed everything, recover the subscriptions" — a first version of external-change handling
  can lean on this existing machinery rather than inventing a new recovery path from scratch.

---

## 5. Design

### 5.1 Opt-in flag

`SQLiteAdapterOptions.experimentalExternalChangeDetection` — **off by default**. Off: today's
behavior, completely unchanged, zero risk for every existing app — the JS-side cache stack
(`RecordCache` + `Database`'s own write-tracking) remains the assumed single source of truth,
exactly as now. On, two independent sub-mechanisms, both SQLite-only:

- **Gap A (update_hook).** Register `sqlite3_update_hook` on the connection opened in
  `native/shared/Sqlite.cpp` / `Database.cpp`. Its callback fires synchronously, in-process, on
  every `INSERT`/`UPDATE`/`DELETE` on that connection — including ones from
  `unsafeExecuteMultiple`. Translate it into the same `TableChange`-shaped structure
  `Database.batch()` already produces, and feed it through the *same*
  `_applyChangesToCache`/`_notify` pipeline (`src/Database/index.ts:509-513`) rather than
  building a second notification path.
- **Gap B (data_version polling).** Poll `PRAGMA data_version` at two triggers, not a tight
  loop: (a) on RN `AppState` transition to `active` — the exact moment upstream #1295's
  scenario needs, since the extension wrote while the main app was backgrounded; (b) a
  generous interval (tens of seconds) while foregrounded, matching this session's own
  `WeakValueCache` sweep-interval precedent (`src/utils/common/WeakValueCache/index.ts`'s
  `SWEEP_INTERVAL_MS`) for "best-effort, not correctness-critical" cadence reasoning. A
  stricter sub-flag checking before every read is a possible future addition for apps willing
  to pay a per-read `PRAGMA` round trip; not the default.
- **LokiJS/web:** setting the flag throws — there is no "another connection wrote to my file"
  concept for an in-memory/IndexedDB-backed store the way there is for a shared SQLite file.
  Out of scope here, matching the precedent in `plans/database-encryption.md` §4.8 of throwing
  on an unsupported option rather than silently ignoring it.

### 5.2 What "a change was detected" actually does

`sqlite3_update_hook` gives table + rowid + operation — cheap to translate directly into a
`TableChange`. `PRAGMA data_version` gives none of that, only "something changed since you
last checked." Two-phase response either way, reusing existing machinery rather than
inventing new plumbing:

1. Reset the adapter-side id-tracking set (`cachedRecords_` / `cachedRecords`) — `RecordCache`
   itself is **not** cleared; its `Model` instances stay alive and identity-stable, since some
   of them may still be correct (this is exactly the invariant #96 exists to protect).
2. Re-run every currently-active `Query`/`Database` subscription — **only what's actually
   observed**, not the whole database, bounding cost to "what the app is watching," not table
   size — and diff the results against `RecordCache`'s current contents to synthesize a real
   `TableChange[]`. Feed it through `Collection#_applyChangesToCache` / `Database#_notify`
   exactly as `Database.batch()` does today. Records that still exist keep their `Model`
   identity with refreshed `_raw`; only genuinely-gone rows are removed.

---

## 6. Phases

### Phase 0 — Research and decisions
- [ ] Confirm `sqlite3_update_hook`'s callback threading model is compatible with Nitro's
      calling conventions (does it need to hop back onto the JS thread before touching
      anything JSI-related, the way `platform::onMemoryAlert`'s callbacks do — see #97).
- [ ] Confirm `PRAGMA data_version` semantics hold as expected in WAL mode across processes on
      iOS, including inside an App Group container shared with an extension (file coordination
      / `NSFileCoordinator` may matter here — needs a real device test, not just simulator).
- [ ] Measure `PRAGMA data_version`'s actual cost on Android/iOS/Windows to validate the
      "cheap enough to poll" assumption.
- [ ] Decide D1 (below): is Gap A's `update_hook` worth enabling unconditionally, separate
      from the Gap B opt-in flag?

### Phase 1 — Gap A only (`sqlite3_update_hook`)
- [ ] Wire the hook in `native/shared/Sqlite.cpp`/`Database.cpp`; translate to `TableChange`.
- [ ] Route through existing `_applyChangesToCache`/`_notify`.
- [ ] Test: `unsafeExecuteMultiple` writes now correctly fire subscribers.

### Phase 2 — Gap B (`data_version` polling)
- [ ] `AppState`-triggered check + background interval, per §5.1.
- [ ] Reconciliation per §5.2 (reset adapter id set, diff active subscriptions, synthesize
      `TableChange[]`).
- [ ] Test: simulate an external writer (e.g. a second `better-sqlite3` connection in the Node
      adapter's test suite) and confirm subscriptions recover on the next `AppState` trigger.

### Phase 3 — Smarter reconciliation
- [ ] Once Gap A gives per-table granularity, narrow Gap B's "re-run everything observed" to
      only tables `data_version` combined with per-table heuristics suggests changed, if
      SQLite exposes enough signal to do so cheaply (needs Phase 0 research first — may not be
      possible without per-table version tracking of our own).

### Phase 4 — Docs and examples
- [ ] `docs-website` page explaining the flag, its cost, and its limits.
- [ ] `examples/NotesApp`: an iOS Share Extension or a second Node connection demonstrating the
      #1295 scenario, before/after the flag.

---

## 7. Testing

| Layer | What |
| --- | --- |
| Jest, SQLite Node adapter | Open a second `better-sqlite3` connection to the same file, write through it directly, assert the flagged adapter detects and reconciles on the next trigger. This is the one place we can test the *cross-connection* scenario without real devices. |
| Jest | `unsafeExecuteMultiple` correctly fires subscribers once Gap A lands (regression test for the specific gap it closes). |
| Native (iOS/Android integration tests) | Real file-level verification that `PRAGMA data_version` behaves as expected under WAL, including from a second connection opened by test code standing in for an extension. |
| Maestro | Given #96's lesson — this class of bug does not reproduce in unit tests — an actual on-device flow exercising the flag should exist before this ships, not just Jest coverage. |

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Repeating #96: reconciliation logic evicts/replaces a live, still-referenced `Model` incorrectly | §5.2's design never clears `RecordCache` wholesale — only diffs and updates in place, through the same tested `_applyChangesToCache` path normal writes use. |
| `data_version` polling adds real per-check SQL cost on a hot path | Default triggers are foreground/interval, not per-read (§5.1); a per-read mode is opt-in-within-opt-in, documented as a cost tradeoff. |
| iOS extension + main app file coordination surprises (locks, `NSFileCoordinator`) | Phase 0 research item; needs a real device/App Group test, not just a simulator run. |
| Feature never gets exercised by most apps (opt-in), bit-rots | Gap A (`update_hook`) is cheap enough to consider unconditional (D1) specifically so the `unsafeExecuteMultiple` fix isn't stuck behind an opt-in nobody flips. |
| Scope creep into rebuilding sync | Explicitly a non-goal (§1) — this is one file, possibly multiple writers, not client-server sync. |

---

## 9. Decisions needed before Phase 1

- **D1.** Should Gap A (`sqlite3_update_hook`) ship unconditionally, independent of the Gap B
  opt-in flag? It's cheap, always correct (same-connection only), and fixes a real blind spot
  (`unsafeExecuteMultiple`) that has nothing to do with whether an app cares about *external*
  writes. Leaning yes, but confirm the Phase 0 threading-model research doesn't surface a
  reason to gate it too.
- **D2.** Exact polling cadence and `AppState` behavior for Gap B — is "tens of seconds
  foregrounded, check on resume" the right default, or should it be configurable per-app given
  how differently apps use background extensions?
- **D3.** How aggressively to reconcile in Phase 2: re-run *every* currently-active
  subscription on any detected change (simple, correct, possibly wasteful for apps with many
  concurrent observed queries), or attempt some cheaper table-level filtering first (deferred
  to Phase 3 pending Phase 0 findings)?

---

## 10. Open questions

- Is there a reasonable way to make Gap B closer to a push notification (e.g. leaning on
  `sqlite3_wal_hook` from a *dedicated watcher connection* that only reads, polling
  `data_version` on WAL-write notifications instead of a timer) rather than pure interval
  polling? Worth a Phase 0 spike but not required for a correct first version.
- Should this eventually generalize into something `Database` exposes as a public
  "external change" event apps can subscribe to directly (distinct from table-scoped
  `withChangesForTables`), for apps that want to react to "someone else touched my data" as a
  first-class signal (e.g. show a "data updated elsewhere" toast)?
