---
name: nitromelondb-audit
description: >
  Use to review how an app uses NitromelonDB (nitromelondb) and find setup
  gaps and misuse: nested writers that deadlock, missing
  experimentalDetectNestedWriters, slow work inside writers, unbatched writes,
  missing migrations or onSetUpError, startup work that races database
  readiness (early auth listeners, observers and writes), models that
  drifted from the schema, fetching where the UI should observe, unsafe raw
  SQL, and sync mistakes. Produces a report with file:line findings ranked by
  severity, then fixes the ones the user picks. Invoke with
  `/nitromelondb-audit`.
license: MIT
metadata:
  author: StasDoskalenko
  version: 0.1.0
---

# Audit a NitromelonDB setup

Review an app's NitromelonDB code against the documented rules, and report what's wrong, what's risky and what's missing.

**This skill reports first and changes nothing.** After the report, ask the user which findings to fix.

Docs index (plain Markdown, one link per page): https://stasdoskalenko.github.io/NitromelonDB/llms.txt

## Rules for the audit

- Give every finding a `file:line`, the code, and one sentence on what goes wrong at runtime.
- Only report what you verified in the code. If a check needs information you don't have (table sizes, what the backend does), say so instead of guessing.
- A check that passes is worth one line in the report. A check that doesn't apply (no sync, no raw SQL) is worth one line too.
- Don't report style preferences. Every finding must trace back to a rule in this file or its references.

## Procedure

### 1. Map the app

Find and read, before checking anything:

- `package.json`: the `nitromelondb` version, React Native / Expo versions, leftover `@nozbe/watermelondb`.
- Every `new Database({ ... })` and the adapter passed to it (`SQLiteAdapter`, `LokiJSAdapter`, `RemoteAdapter`).
- The schema (`appSchema` / `tableSchema`) and its `version`.
- The migrations (`schemaMigrations`).
- Every class that extends `Model`, with its `static table`, `static associations` and decorated fields.
- Every `synchronize(` call.
- Babel config and `tsconfig.json`.
- The test setup that creates a database, if any.

Then build two lists you'll use in step 3:

- **Writer entry points:** every `@writer` method (class and method name), every function whose body calls `database.write(` / `.write(` on a database, and `useWriter` / `useAtomicWriter` callbacks.
- **Reader entry points:** the same for `@reader` and `database.read(`.

### 2. Setup checks

See [references/setup-checks.md](references/setup-checks.md) for what to look for and why. In short:

| ID | Check | Severity if it fails |
| --- | --- | --- |
| S1 | `migrations` is passed to the adapter | High |
| S2 | Migrations and schema agree (versions, tables, columns) | High |
| S3 | `experimentalDetectNestedWriters` is on in development and tests, off in production | Medium |
| S4 | `onSetUpError` is implemented | Medium |
| S5 | One `Database` per database file, created once | High |
| S6 | Readiness: early listeners, observers and writes are gated on `readyPromise` / `useDatabaseReady`. No hand-made waiting, no seeding from the UI, no reliance on adapter internals | Medium |
| S7 | No leftovers from WatermelonDB (`jsi: false`, old imports, old native linking) | High |
| S8 | Decorators are compiled correctly for the platform | High |
| S9 | `storeWholeNumbersAsIntegers` is on, or the raw SQL that blocks it is listed | Low |
| S10 | The logger is routed to the app's error reporting | Low |

### 3. Writer and reader checks

See [references/writer-checks.md](references/writer-checks.md). In short:

| ID | Check | Severity if it fails |
| --- | --- | --- |
| W1 | A writer or reader called from inside another and waited for, without `callWriter()` / `callReader()` | High (deadlock) |
| W2 | `synchronize()` called from inside a writer or reader | High (deadlock) |
| W3 | Slow, unrelated work inside a writer: network requests, timers, file I/O, user prompts | Medium |
| W4 | Several `create` / `update` / delete calls in one writer, or in a loop, instead of one `batch()` | Medium |
| W5 | Missing `await` on `create()` / `update()` / `batch()`, or a non-async function passed to `write()` | High |
| W6 | Records changed outside a writer, or fields assigned outside the `update()` / `create()` builder | High |
| W7 | Fetching records one by one to delete them, instead of `markAllAsDeleted()` / `destroyAllPermanently()` | Low |
| W8 | Long writers without a `description` | Low |

### 4. Model, query and UI checks

See [references/model-query-checks.md](references/model-query-checks.md). In short:

| ID | Check | Severity if it fails |
| --- | --- | --- |
| M1 | Every model is in `modelClasses`, and every `static table` is in the schema | High |
| M2 | Decorated fields match schema columns: name, type, and `null` for optional columns | High / Medium |
| M3 | Associations exist for every `@children`, `@relation` and `Q.on`, with the right key | High |
| Q1 | User input in `Q.unsafeSqlQuery` / `Q.unsafeSqlExpr` / `unsafeExecute` without placeholders, or `Q.like` without `Q.sanitizeLikeString` | High |
| Q2 | Objects from `unsafeFetchRaw()` are mutated | High |
| Q3 | `fetch()` only to count or to read IDs, or `observe()` only to count | Low |
| Q4 | A component fetches once and stores the result in state, where it should observe | Medium |
| Q5 | A sorted, observed list that doesn't re-sort (`observe()` where `observeWithColumns()` is needed) | Medium |
| Q6 | Tables wiped outside the normal write API without `resetObservablesCache()` | Medium |
| Q7 | Columns that are queried often and aren't indexed | Low (hand over to `nitromelondb-indexes`) |

### 5. Sync checks

Skip this step if the app never calls `synchronize()`. Otherwise see [references/sync-checks.md](references/sync-checks.md). In short:

| ID | Check | Severity if it fails |
| --- | --- | --- |
| Y1 | `pushChanges` resolves even when the backend failed | High (data loss) |
| Y2 | `synchronize()` can run twice at the same time | Medium |
| Y3 | No `migrationsEnabledAtVersion`, or old migrations deleted | High |
| Y4 | The database is reset while a sync may be running | High |
| Y5 | No retry after a failed sync | Low |
| Y6 | Sync triggered by `withChangesForTables` without debounce | Medium |
| Y7 | Sync logs (`log`) or raw `changes` are stored or sent uncensored | Medium |
| Y8 | The pulled `changes` object, or `pushChanges` arguments, are stored or mutated | Medium |
| Y9 | Large pulls without `paginatedPulls` | Low |

### 6. Write the report

Use this shape:

```markdown
# NitromelonDB audit

nitromelondb <version> · <SQLite | LokiJS | ...> adapter · schema version <n> · <n> models · sync: <yes | no>

## High
- **W1 Nested writer without callWriter** `src/model/Comment.ts:42`
  `await post.appendToBody(this.body)` inside `@writer appendToPost`. `appendToBody` is a `@writer`, so this never finishes.
  Fix: `await this.callWriter(() => post.appendToBody(this.body))`

## Medium
...

## Low
...

## Passed
S1, S4, M1, ... (one line)

## Not applicable / couldn't check
Y*: the app doesn't sync. Q7: needs table sizes.
```

Sort by severity, then by how many places are affected. Group repeats of the same problem into one finding with a list of locations.

### 7. Fix what the user picks

Ask which findings to fix. Then:

- Fix one finding at a time, and keep each change small.
- Anything that changes stored data or the schema (a migration, `storeWholeNumbersAsIntegers`, a new `seed`) needs the user's explicit yes, even if they said "fix everything".
- After the fixes, run the type checker and the tests.
- Turning on `experimentalDetectNestedWriters` in the test setup is the cheapest way to prove the W1 fixes: on Node and Jest it follows every `await`.
