---
title: Performance
hide_title: true
description: "Make SQLite faster: store whole numbers as integers (opt-in)."
---

# Performance

## Store whole numbers as integers (opt-in)

```js
const adapter = new SQLiteAdapter({
  schema,
  storeWholeNumbersAsIntegers: true,
})
```

JavaScript numbers are all doubles, so by default every number is stored as a SQLite `REAL` (8 bytes). With `storeWholeNumbersAsIntegers`, whole numbers (counts, IDs stored as numbers, `Date.now()` timestamps, enum values) are stored as SQLite `INTEGER` instead, which takes 0 to 8 bytes and which SQLite compares and sorts faster.

In the benchmark app (iOS simulator, Release builds, against the same build without the option), queries that scan or sort a table of 100,000 records got **10% faster**, which puts them ahead of WatermelonDB on that test. Sync and writes stayed within 1 to 2%: they spend most of their time elsewhere. So this mostly helps apps that filter or sort large tables on number columns.

iOS, Android, Windows and Node. The web adapter ignores it.

### Is it safe for my app?

**If you only use the regular API, yes.** Queries built with `Q` (`Q.where`, `Q.gt`, `Q.oneOf`, `Q.sortBy`, …), models, `observe()` and sync return exactly the same values either way.

**Check your raw SQL first.** `Q.unsafeSqlQuery`, `Q.unsafeSqlExpr` and `unsafeExecute` can see how a number is stored:

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

**Development builds help you find them.** With the option on, the first time a query's raw SQL uses `/`, `||`, `cast(… as text)`, `printf()` or `typeof()`, or `Q.like` / `Q.includes` runs on a number column, NitromelonDB logs a warning naming the query. It can't tell which columns raw SQL touches, so some warnings will be about SQL that's fine (`first_name || ' ' || last_name`). Production builds don't check.

### Existing data

Turn the option on and the data already on your users' devices is converted for you, once, in the background, after the database opens:

- **Nothing to write and no launch delay.** It runs behind your app's own reads and writes, a few thousand rows at a time (about 1 second per million rows on a Mac, in steps of about 10 ms).
- **Values don't change**, only how they're stored: `42.0` becomes `42`, the same JS number. Records aren't marked as changed, so sync doesn't push anything and observers don't fire.
- **Safe to interrupt.** If the app is closed, it continues on the next launch.
- Until it finishes, a table holds both kinds. Queries built with `Q` compare and sort them together, so they don't care; raw SQL arithmetic sees whichever kind a row has.

It runs once per database. If you turn the option off, numbers are written as `REAL` again, and rows written while it was off stay `REAL` if you turn it back on, until they're written again.
