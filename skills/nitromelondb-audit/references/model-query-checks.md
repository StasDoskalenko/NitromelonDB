# Model, query and UI checks

Docs: [Model](https://stasdoskalenko.github.io/NitromelonDB/docs/Model.md), [Schema](https://stasdoskalenko.github.io/NitromelonDB/docs/Schema.md), [Query](https://stasdoskalenko.github.io/NitromelonDB/docs/Query.md), [Components](https://stasdoskalenko.github.io/NitromelonDB/docs/Components.md), [Hooks](https://stasdoskalenko.github.io/NitromelonDB/docs/Hooks.md), [CRUD](https://stasdoskalenko.github.io/NitromelonDB/docs/CRUD.md)

## M1. Models are registered

- Every class that extends `Model` and has a `static table` is in `modelClasses`. A missing one fails the first time its collection is used.
- Every `static table` names a table in the schema.
- Every `database.get('name')` / `collections.get('name')` string names a real table. Suggest `database.get(ModelClass)` where the class is at hand: it's typed, and a typo can't compile.

## M2. Fields match the schema

Nothing checks model fields against the schema, in JavaScript or TypeScript. Compare them one by one.

| Drift | Example | What happens | Severity |
| --- | --- | --- | --- |
| Column name not in the schema | `@field('positon')` | Reads return `undefined`. Writes throw. | High |
| Column removed or renamed by a migration, model not updated | `@field('legacy_flag')` | Same | High |
| Field with no decorator | `title!: string` | Always `undefined`, never stored | High |
| Wrong type | a `number` column typed `string` | Writes of the wrong type are silently stored as `''`, `0`, `false` or `null` | High |
| Optional column typed without `null` | `isOptional: true`, field `subtitle!: string` | Reads return `null` typed as `string` | Medium |
| Decorator doesn't fit the column | `@date` on a `string` column, `@text` on a `number` column | Wrong values | High |
| `@json` without a sanitizer | `@json('meta')` | The sanitizer is a required argument: the field fails when read or written | High |

Expected pairs: `@field` on `string`, `number` or `boolean`. `@text` on `string`. `@date` on a `number` column, typed `Date` (or `Date | null`). `@relation` / `@immutableRelation` on a `string` column that holds the ID. `@children` takes a table name, not a column.

`!` on TypeScript fields is expected, not a problem.

A schema column that no model field uses is Low: it may be read through raw SQL or sync only.

## M3. Associations

- `@children('comments')` on `Post` needs `static associations = { comments: { type: 'has_many', foreignKey: 'post_id' } }` on `Post`.
- `@relation('posts', 'post_id')` on `Comment` needs `posts: { type: 'belongs_to', key: 'post_id' }` on `Comment`.
- `has_many` uses `foreignKey`. `belongs_to` uses `key`. Swapping them is a common mistake.
- `Q.on('table', ...)` needs the two tables to be associated, on the model being queried.
- `Q.on` nested inside `Q.and` / `Q.or` needs `Q.experimentalJoinTables([...])`. `Q.on` inside `Q.on` needs `Q.experimentalNestedJoin(...)`. So does an observed `Q.unsafeSqlQuery` that joins.
- The foreign key column exists in the schema.

## Q1. Unsafe input in queries

High:

- Template strings or concatenation with a variable inside `Q.unsafeSqlQuery`, `Q.unsafeSqlExpr`, `Q.sortBy(Q.unsafeSqlExpr(...))`, `unsafeExecute`, `unsafeExecuteSql`. `Q.unsafeSqlQuery` takes placeholders: `Q.unsafeSqlQuery('select * from comments where foo is not ?', ['bar'])`. For the others, validate against a fixed list.
- `Q.like` / `Q.notLike` with user text that didn't go through `Q.sanitizeLikeString()`.
- A column or table name taken from user input or a server response without checking it against a fixed list (`Q.where(userColumn, ...)`, `Q.sortBy(sortKeyFromRoute)`).
- Values from JSON passed to `Q.eq`, `Q.oneOf`, `Q.notIn` without checking they're strings, numbers, booleans or `null`. An object there is a risk.

Raw SQL written for SQLite doesn't run on LokiJS. If the app ships both, flag raw SQL that isn't behind a platform check.

## Q2. Mutating raw results

Objects returned by `query.unsafeFetchRaw()` must not be changed. Mutating them corrupts the database's cache. Copy first.

## Q3. Fetching more than needed

- `(await query.fetch()).length` → `query.fetchCount()`.
- `query.observe()` used only for `.length` → `query.observeCount()`.
- `fetch()` then `.map(r => r.id)` → `query.fetchIds()`.
- A long list loaded whole and sliced in JavaScript → `Q.sortBy` with `Q.take` / `Q.skip`.

Low, unless the table is large.

## Q4. Fetching where the UI should observe

A component that calls `query.fetch()` / `collection.find()` in an effect and keeps the result in `useState`, or reads a record's fields without observing it, shows stale data after the next write or sync.

Use `useQuery(query)`, `useRecord(record)` or `useObservable(...)` from `nitromelondb/hooks`, or `withObservables`. For a count, `observeCount()`.

Not a finding: a one-off read in an event handler, an export, or a non-UI service.

## Q5. Sorted lists that don't re-sort

`query.observe()` (and `useQuery(query)` without columns) re-emits when records join or leave the list, not when a field of a listed record changes. A list sorted or grouped by a field in JavaScript then keeps its old order.

Use `query.observeWithColumns(['likes'])`, or `useQuery` with its `columnNames` parameter, naming the columns the order depends on.

Each row should observe its own record (`useRecord`, or `withObservables(['comment'], ...)`) rather than having the list re-render for every field change.

## Q6. Wiping tables behind the database's back

- Tables cleared with raw SQL or `unsafeExecute` (a custom logout): call `database.resetObservablesCache()` (or `collection.resetObservablesCache()`) right after, in the same writer. Otherwise observers keep showing the old data.
- `unsafeResetDatabase()` while components still observe the database: they briefly show the previous user's data. Unmount them first, or use one `Database` per user.
- `unsafeResetDatabase()` while a sync may be running: see Y4 in the sync checks.
- Prefer `query.destroyAllPermanently()` over raw SQL to clear specific tables.

## Q7. Missing indexes

Don't work this out here. If queries filter on columns that aren't `isIndexed` (foreign keys above all), or every column is indexed "to be safe", note it as Low and recommend the `nitromelondb-indexes` skill, which checks each query and writes the migration.
