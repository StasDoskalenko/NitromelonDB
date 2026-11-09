---
title: Performance
hide_title: true
description: "Make SQLite faster: store whole numbers as integers (opt-in), and how number columns are stored."
---

# Performance

## Store whole numbers as integers (opt-in)

```js
const adapter = new SQLiteAdapter({
  schema,
  storeWholeNumbersAsIntegers: true,
})
```

JavaScript numbers are all doubles, so by default every number is stored as a SQLite `REAL`. With `storeWholeNumbersAsIntegers`, whole numbers (counts, IDs stored as numbers, `Date.now()` timestamps, enum values) are stored as SQLite `INTEGER` instead, which SQLite compares and sorts faster.

In the benchmark app (iOS simulator, Release builds, against the same build without the option), queries that scan or sort a table of 100,000 records got **10% faster**, which puts them ahead of WatermelonDB on that test. Sync and writes stayed within 1 to 2%: they spend most of their time elsewhere. So this mostly helps apps that filter or sort large tables on number columns.

iOS, Android and Windows only. The Node and web adapters ignore it.

### Is it safe for my app?

**If you only use the regular API, yes.** Queries built with `Q` (`Q.where`, `Q.gt`, `Q.oneOf`, `Q.sortBy`, …), models, `observe()` and sync return exactly the same values either way.

**Check your raw SQL first.** `Q.unsafeSqlQuery`, `Q.unsafeSqlExpr` and `unsafeExecute` can see how a number is stored, on rows written with the option on:

| In raw SQL | Stored as `REAL` (default) | Stored as `INTEGER` (option on) |
| --- | --- | --- |
| `total / count`, with both whole numbers | `7 / 2` is `3.5` | `7 / 2` is `3` (integer division) |
| `price \|\| ''`, `cast(price as text)` | `'42.0'` | `'42'` |
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

If you have queries like that, make the division a float division (`sum(total) * 1.0 / count(*)`, or `avg(total)`), and use `total()` instead of `sum()` for very large sums. Then it's safe to turn on.

### Existing data

Nothing is migrated. Rows written before you turn it on keep their numbers as `REAL` until they're written again, and SQLite compares and sorts the two kinds together, so queries built with `Q` don't care. Raw SQL arithmetic sees whichever kind a row has.

Turning it off later only affects new writes: rows already stored as `INTEGER` stay that way.

## Number columns in new tables are declared `REAL`

This one is automatic. Tables created by NitromelonDB (a new database, `createTable` and `addColumns` migrations) declare number columns as `REAL`. SQLite then stores whole numbers in its compact integer format on disk and reads them back as `REAL`, so databases get smaller (11 to 18% in the benchmark app) while every query sees exactly the same values and types as before. Existing tables keep their columns as they are.

It doesn't make queries faster: SQLite converts each value back to `REAL` as it reads it. That's what `storeWholeNumbersAsIntegers` changes, which is why, with the option on, new tables leave number columns untyped.
