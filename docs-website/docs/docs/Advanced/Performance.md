---
title: Performance
hide_title: true
description: "Build a fast NitromelonDB app: observing, lists, writes, batching, indexes, setup and sync patterns, and storing whole numbers as integers (opt-in)."
---

# Performance

## Building a fast app

Most of an app's speed comes from how it reads and writes, not from the database engine. These are the patterns to follow. The [agent skills](../AgentSkills.md) apply them when they install NitromelonDB, design a schema or set up sync, and the audit checks an existing app against them.

### Setup

- **One `Database`**, created once at module level (or once per logged-in user, each with its own `dbName`). Never in a component body or per screen.
- **`storeWholeNumbersAsIntegers: true`** on `SQLiteAdapter` in new apps (see [below](#store-whole-numbers-as-integers-opt-in) for existing ones).
- **`migrations` from day one**, even an empty list, so the first schema change after release doesn't need a reset.
- **`experimentalDetectNestedWriters: __DEV__`**, and on unconditionally in the Jest setup, so a forgotten `callWriter()` throws instead of hanging. See [Detect nested writers](./DetectNestedWriters.md).
- **Initial data with [`seed`](./Seeding.md)**, not from an effect that checks whether a table is empty.
- **Gate on readiness only if launch does work** that reads or writes (auth listeners, sync on start): `database.readyPromise`, or `useDatabaseReady(database)` in React. Reads and writes queue on their own otherwise.

### Reading in the UI

- **Observe, don't fetch into state.** `useQuery(query)` / `useRecord(record)` from `nitromelondb/hooks` (or `withObservables`). A `fetch()` in an effect shows stale data after the next write or sync.
- **Lists: the list observes the set, each row observes its record.** `useQuery(query)` in the list re-renders when records join or leave, `useRecord(record)` in the row re-renders only that row when it changes. When the order depends on a field, pass it instead: `useQuery(query, ['position'])`. Components observing the same query with the same columns share one subscription.
- **Counts and IDs:** `observeCount()` / `fetchCount()` and `fetchIds()`, never `fetch()` and `.length`.
- **Long lists: page in the query.** `Q.sortBy(...)` with `Q.take(n)` (and `Q.skip`), not the whole table sliced in JavaScript.
- **Watch the queries that re-run on every change.** A query with `Q.on`, `Q.sortBy`, `Q.take`, `Q.skip` or raw SQL can't be checked against a changed record in JavaScript, so it runs again whenever its table changes. Keep them few on busy tables, and back them with indexes.
- **Avoid a query per row.** `post.comments.observeCount()` in every row of a 200-row list is 200 queries that re-run on writes. Load what the screen needs once, or store the count on the parent if it's shown everywhere.
- **Index what queries filter and join on**: foreign keys (`_id` columns) above all, and columns looked up by equality. Nothing else. The [`nitromelondb-indexes`](../AgentSkills.md) skill finds them from your queries.
- **A record that may not exist** (deleted, not synced yet): `collection.findAndObserveOrNull(id)` instead of `findAndObserve(id)`.
- **`database.get(Post)`** (the class) instead of `database.get('posts')`: typed, and a typo can't compile.

### Writing

- **One writer per user action**, and inside it **one `batch()`**: `prepareCreate` / `prepareUpdate` / `prepareMarkAsDeleted` for every record, then `batch(...)` once. Never `await create()` in a loop. See [Batch updates](../Writers.md#batch-updates).
- **Keep writers short.** Writers run one at a time, app-wide, sync included. Network requests, file work and prompts go before or after the writer, never inside.
- **Pick the narrowest tool:** `useAtomicWriter(Model, record, builder)` to set fields on one record (it can't contain slow work), `useWriter(record, fn)` for an action anchored to a record that touches others, `@writer` methods on models for domain logic, `database.write()` for the rest. A writer calling another uses `callWriter()`. See [Hooks](../Hooks.md).
- **Delete in bulk with the query:** `query.markAllAsDeleted()` (synced data) or `query.destroyAllPermanently()` (local-only data), not a fetch and a loop. In a table that syncs, deletes the user makes use `markAsDeleted()`: a permanent delete is never pushed.

### Sync

- **One sync at a time**, started from one function that returns the running sync, retried once after a failure, and debounced when it's triggered by local changes. See [Sync frontend](../Sync/Frontend.md).
- **`paginatedPulls: true`**, so a first sync arrives in pages and is applied as it comes (versions after 0.32.0).
- **A backend that sends every record as `updated`**, with `sendCreatedAsUpdated: true`. See [Sync backend](../Sync/Backend.md).

## Store whole numbers as integers (opt-in)

```js
const adapter = new SQLiteAdapter({
  schema,
  storeWholeNumbersAsIntegers: true,
})
```

JavaScript numbers are all doubles, so by default every number is stored as a SQLite `REAL` (8 bytes). With `storeWholeNumbersAsIntegers`, whole numbers (counts, IDs stored as numbers, `Date.now()` timestamps, enum values) are stored as SQLite `INTEGER` instead, which takes 0 to 8 bytes and which SQLite compares and sorts faster.

In the benchmark app (iOS simulator, Release builds, against the same build without the option), queries that scan or sort a table of 100,000 records got **10% faster**, which puts them ahead of WatermelonDB on that test. Sync and writes stayed within 1 to 2%: they spend most of their time elsewhere. So this mostly helps apps that filter or sort large tables on number columns.

iOS, Android, Windows and Node. The web adapter ignores it: wa-sqlite already stores whole numbers that fit in 32 bits as `INTEGER`, so on web the raw SQL differences below already apply to those.

**Nothing changes until you turn it on.** Then, it changes nothing your app can see through the regular API. Only raw SQL can tell the difference, so the steps below are mostly about checking that.

## Turning it on, step by step

### 1. Check your raw SQL

**If your app has no raw SQL, skip to step 2.** Queries built with `Q` (`Q.where`, `Q.gt`, `Q.oneOf`, `Q.sortBy`, …), models, `observe()` and sync return exactly the same values either way.

Raw SQL is `Q.unsafeSqlQuery`, `Q.unsafeSqlExpr`, `unsafeExecute`, and `unsafeExecuteSql` migration steps. It can see how a number is stored:

| In raw SQL | Stored as `REAL` (default) | Stored as `INTEGER` (option on) |
| --- | --- | --- |
| `total / count`, with both whole numbers | `7 / 2` is `3.5` | `7 / 2` is `3` (integer division) |
| `price \|\| ''`, `cast(price as text)`, `printf('%s', price)` | `'42.0'` | `'42'` |
| `typeof(price)` | `'real'` | `'integer'` |
| `sum(price)` past 2⁶³ | a float | an `integer overflow` error |

`Q.like` and `Q.includes` on a number column compare against that text form too.

For example, this average silently loses its fraction with the option on:

```js
const [row] = await orders
  .query(Q.unsafeSqlQuery('select sum(total) / count(*) as average from orders'))
  .unsafeFetchRaw()
// totals 10 and 15: 12.5 by default, 12 with storeWholeNumbersAsIntegers
```

The fixes work with the option on or off, so you can make them first:

| Instead of | Write |
| --- | --- |
| `a / b` | `a * 1.0 / b`, or `avg(a)` for an average |
| `sum(a)`, if it can pass 2⁶³ | `total(a)` |
| `a \|\| ''`, `cast(a as text)` on a number column | format the number in JavaScript |
| `typeof(a) = 'real'` | `typeof(a) in ('integer', 'real')` |
| `Q.where('price', Q.like(...))` | a numeric comparison (`Q.gte`, `Q.lt`, `Q.between`), or a string column |

#### Asking an AI coding agent to check

The [`nitromelondb-audit` agent skill](../AgentSkills.md) runs this check as part of a wider review. For this check alone, paste this into your coding agent (Claude Code, Cursor, Copilot, …) from your app's repository:

````text
I want to turn on NitromelonDB's `storeWholeNumbersAsIntegers` option on SQLiteAdapter. With it,
whole numbers in `number` columns are stored as SQLite INTEGER instead of REAL. Queries built with
Q, models, observe() and sync behave exactly the same. Only raw SQL can see the difference:
- `/` between two whole numbers is integer division (7 / 2 is 3, not 3.5)
- converting a number to text gives '42' instead of '42.0': `||`, cast(x as text), printf/format,
  and Q.like / Q.includes on a number column
- typeof(x) returns 'integer' instead of 'real'
- sum() overflows with an error past 2^63 (total() doesn't)

Check whether it's safe for this app:
1. Find all raw SQL: Q.unsafeSqlQuery, Q.unsafeSqlExpr, Q.sortBy(Q.unsafeSqlExpr(...)),
   unsafeExecute ({ sqls } and { sqlString }), unsafeExecuteSql migration steps, and
   Q.like / Q.includes / Q.notLike.
2. Find the app's schema (appSchema / tableSchema) to know which columns have type 'number'.
3. For each raw SQL use, decide whether any of the operations above touch a number column (or an
   expression built from one). Give file:line, the SQL, and SAFE or AFFECTED with a one-line reason.
4. For each AFFECTED one, propose a fix that returns the same result with the option on or off:
   `a * 1.0 / b` or avg() instead of `a / b`; total() instead of sum() for very large sums;
   formatting numbers in JavaScript instead of SQL; numeric comparisons instead of LIKE on numbers.
5. Don't turn the option on yourself. Finish with a summary: safe to turn on as is, or safe after
   the listed fixes.
````

### 2. Try it in a development build

Turn the option on and use the app. Development builds help you find what step 1 missed: the first time a query's raw SQL uses `/`, `||`, `cast(… as text)`, `printf()` or `typeof()`, or `Q.like` / `Q.includes` runs on a number column, NitromelonDB logs a warning naming the query:

```text
[🍉] [storeWholeNumbersAsIntegers] This raw SQL may return something different for numbers stored as INTEGER: `/` is integer division when both sides are whole numbers. ...
SQL: select sum(total) / count(*) as average from orders
```

It can't tell which columns raw SQL touches, so some warnings will be about SQL that's fine (`first_name || ' ' || last_name`). Production builds don't check.

### 3. Ship it

Data already on your users' devices is converted for you, once, in the background, after the database opens:

- **No launch delay and nothing for you to write.** It runs behind your app's own reads and writes, a few thousand rows at a time (about 1 second per million rows on a Mac, in steps of about 10 ms).
- **Values don't change**, only how they're stored: `42.0` becomes `42`, the same JS number. Records aren't marked as changed, so sync doesn't push anything and observers don't fire.
- **Safe to interrupt.** If the app is closed, it continues on the next launch.
- Until it finishes, a table holds both kinds. Queries built with `Q` compare and sort them together, so they don't care; raw SQL arithmetic sees whichever kind a row has.

**There's nothing to wait for.** Opening the database, `database.readyPromise`, [seeding](./Seeding.md), sync and your first queries run exactly as before, alongside the conversion. Rows written meanwhile are already stored the new way, so the conversion skips them. Raw SQL that gives the same result either way (step 1) doesn't mind a half-converted table either. In development builds, NitromelonDB logs `[🍉] storeWholeNumbersAsIntegers: converted the numbers already stored to INTEGER in … ms` when it's done.

### 4. Rolling back

**Turning the option off converts the numbers back to `REAL`,** the same way: once, in the background, on the first launch without it. If a release with the option on turns out to break a query you missed, shipping a release with it off puts the data back the way it was, and raw SQL sees exactly what it did before. The same applies if you turn it off before a conversion finished.

## Checking the data yourself

To see how a column is stored right now:

```js
const [row] = await database
  .get('orders')
  .query(
    Q.unsafeSqlQuery(
      `select
         sum(typeof(total) = 'integer') as integers,
         sum(typeof(total) = 'real' and total = cast(total as integer)) as wholeNumbersAsReal
       from orders`,
    ),
  )
  .unsafeFetchRaw()
// Option on, conversion finished: wholeNumbersAsReal is 0
```
