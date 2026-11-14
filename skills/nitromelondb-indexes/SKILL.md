---
name: nitromelondb-indexes
description: >
  Use to find missing (and wasteful) database indexes in an app that uses
  NitromelonDB (nitromelondb), and to add them safely. Inventories every
  query, observer, relation and raw SQL statement, works out which columns
  they filter and join on, compares that with `isIndexed` in the schema,
  checks candidates with EXPLAIN QUERY PLAN when a database file is available,
  and writes the schema change plus the migration that creates the index on
  existing installs. Invoke with `/nitromelondb-indexes`.
license: MIT
metadata:
  author: StasDoskalenko
  version: 0.1.0
---

# Find and add missing indexes

An index makes queries that filter or join on a column faster. It also makes every create and update on that table slower, and the database file bigger. So the goal isn't "index what's queried". It's a short list of indexes that pay for themselves, each one backed by a query you can point at.

Docs: [Schema: Indexing](https://stasdoskalenko.github.io/NitromelonDB/docs/Schema.md), [Migrations](https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/Migrations.md), [Query](https://stasdoskalenko.github.io/NitromelonDB/docs/Query.md)

**Report first.** Steps 1 to 5 change nothing. Step 6 changes the schema and adds a migration, and needs the user's go-ahead.

## Step-by-step procedure

### 1. Read the schema, the migrations and the adapter

- The schema (`appSchema` / `tableSchema`): for each table, its columns, and which have `isIndexed: true`. Note `unsafeSql` on a table or the schema: it may already create indexes by hand.
- The migrations (`schemaMigrations`) and the current schema `version`. Note `unsafeExecuteSql` steps that create indexes.
- The adapter: `SQLiteAdapter` (iOS, Android, Windows, Node, and web with wa-sqlite) or `LokiJSAdapter`. If the app ships LokiJS, read "LokiJS" under step 6 before proposing anything.

Every table already has these, so never propose them: the primary key `id`, and an index on `_status`.

### 2. List every query

Search the app (not `node_modules`) and record, per query: the table, the columns it filters on, the columns it joins on, what it sorts by, whether it has `Q.take`, and where it's used.

| Source | What it filters or joins on |
| --- | --- |
| `collection.query(Q.where('col', ...))` and `query.extend(...)` | `col` on the collection's table |
| `@children('comments')` on `Post` | the `foreignKey` of the `has_many` association: `comments.post_id` |
| `@relation('posts', 'post_id')` / `relation.fetch()` / `collection.find(id)` | `posts.id`, the primary key. Already indexed, nothing to do |
| `Q.on('comments', 'post_id', id)` | `comments.post_id`, plus the join itself: the association's key column on whichever table holds it |
| `Q.on` inside `Q.on` (`Q.experimentalNestedJoin`) | each join's key column |
| Many-to-many through a pivot table | both `_id` columns of the pivot table |
| `Q.sortBy('col')` with `Q.take(n)` | `col`, see step 3 |
| `Q.unsafeSqlQuery`, `Q.unsafeSqlExpr`, `unsafeExecute` | read the SQL: `where`, `join ... on`, `order by`, `group by` |
| Custom queries on models (`@lazy`, getters returning `this.collections.get(...).query(...)`) | same as `collection.query` |
| Sync | nothing to add: it reads by `_status` (indexed) and by `id` |

Then note how each query runs. This decides how much an index is worth:

- **Observed** (`observe()`, `observeCount()`, `observeWithColumns()`, `useQuery`, `withObservables`): runs at least once per mount.
- **Observed and re-run on every change:** a query with `Q.on`, `Q.sortBy`, `Q.take` / `Q.skip`, `Q.unsafeSqlExpr` or `Q.unsafeSqlQuery` can't be checked against a changed record in JavaScript, so it runs again whenever its table (or a joined table) changes. On a busy table these are the most expensive queries in the app.
- **In a list row:** a query per row (`post.comments.observeCount()` for each post on screen) runs once per row.
- **Fetched once** in an event handler or a background job.

### 3. Decide which columns are candidates

For each table, group the queries by the columns they filter on. A column is a candidate when a query filters on it with `Q.eq` / a plain value, `Q.oneOf`, a range (`Q.gt`, `Q.lt`, `Q.between`), or joins on it, and the column isn't indexed.

Then rank the candidates. Be strict:

**Usually worth it**

- **Foreign keys** (`_id` columns) used by `@children`, `Q.on` or `Q.where('x_id', id)`. This is the common missing index, and the common big win: without it, every "children of this record" query reads the whole child table.
- Both `_id` columns of a pivot table.
- A column with many distinct values that hot queries look up by equality (an external ID, a slug, a `remote_id`).

**Sometimes worth it. Say why, or leave it**

- A boolean or status column: only when the queried value is rare (`is_archived = true` on a table where 1% is archived). An index on a column where half the rows match doesn't help.
- A `number` column used for a range together with `Q.take` on a large table (a feed of the newest 50).
- A date (`_at`) column: rarely. Only for a range or a sorted `Q.take` on a large table, with a query to show for it.

**Not worth it**

- Long text. Never index user-written text.
- Columns only used in `Q.like('%text%')`: a leading wildcard can't use an index.
- Columns only used in `Q.notEq`, `Q.notIn`, `Q.notLike`.
- Columns compared inside an expression (`CAST(col AS INTEGER)`, `lower(col)`): the index isn't used.
- Columns of small tables. Under a few thousand rows, reading the whole table is fast.
- A column that's only sorted by, with no `Q.take`: the database has to read all the rows anyway.
- A second filter column on a query whose first filter is already indexed and narrows the rows well (`post_id = ? and is_spam = false`: `post_id` does the work).

**Table size matters more than anything above.** If you can't tell how many rows a table has, ask the user which tables grow large, or count them in a database file (step 4). Don't recommend indexes for tables you can't show are large or growing.

`isIndexed` makes a single-column index. When a hot query filters on two columns that are each weak alone, a two-column index may be the real answer. That needs raw SQL in both the schema and the migration (see step 6). Propose it only with a query plan that shows the single-column index isn't enough.

### 4. Check with the real database, if you can

A query plan beats reasoning. If a development build of the app is installed on a simulator or emulator, copy its database and ask SQLite:

```bash
# iOS simulator (dbName defaults to "watermelon")
DB="$(xcrun simctl get_app_container booted <bundleId> data)/Documents/watermelon.db"

# Android emulator, debug build: copy the file and its WAL
for f in watermelon.db watermelon.db-wal; do
  adb exec-out run-as <applicationId> cat "$f" > "$f"
done
```

Work on a copy, and only read from it.

```bash
sqlite3 copy.db "select name, tbl_name from sqlite_master where type = 'index';"
sqlite3 copy.db "select count(*) from comments;"
sqlite3 copy.db "explain query plan select * from comments where post_id = 'abc' and _status is not 'deleted';"
```

- `SCAN comments` means the whole table is read: an index would help if the table is large.
- `SEARCH comments USING INDEX comments_post_id (post_id=?)` means an index is used.
- `USE TEMP B-TREE FOR ORDER BY` means the sort isn't helped by an index. That matters only together with `Q.take` on a large table.

Queries built with `Q` add `_status is not 'deleted'` to the `where`. Write the SQL for a `Q` query by hand from its conditions: you don't need it exact, only the same filters and joins.

To test a candidate, create the index on the copy (`create index "comments_post_id" on "comments" ("post_id");`), run `explain query plan` again, and time the query before and after with `.timer on`. An index SQLite doesn't choose is an index not to add.

If there's no database to look at, or it's nearly empty, say so in the report, and mark the recommendations as based on the code only.

### 5. Report

```markdown
# Index review

SQLite adapter · schema version 12 · 9 tables · 31 queries checked · database file: checked (comments: 48,210 rows)

## Add
| Column | Used by | Why |
| --- | --- | --- |
| `comments.post_id` | `Post.comments` (`@children`), observed in `PostScreen.tsx:41` and per row in `PostList.tsx:63` | Foreign key, not indexed. Plan: `SCAN comments` → `SEARCH ... USING INDEX`. 38 ms → 0.4 ms |

## Consider
...with what would decide it (table size, how rare the value is)

## Remove
| Column | Why |
| --- | --- |
| `posts.body` | Indexed long text, no query filters on it |

## Leave as is
One line per candidate you rejected, with the reason.
```

Also list indexed columns that no query filters on. Each one slows writes for nothing. Removing an index is a schema change too, so it's only a suggestion.

Then ask the user which ones to apply.

### 6. Apply: schema and migration together

A fresh install builds its indexes from the schema. An existing install only changes through a migration. An index needs both, or the two kinds of install end up different.

Follow the order from the Migrations docs: migration first, then the schema, then the version. For an index on an **existing** column:

**a. Add a migration** one version above the current schema version. There's no dedicated "add index" step, so use `unsafeExecuteSql`:

```js
import { schemaMigrations, unsafeExecuteSql } from 'nitromelondb/Schema/migrations'

export default schemaMigrations({
  migrations: [
    {
      toVersion: 13,
      steps: [
        unsafeExecuteSql('create index if not exists "comments_post_id" on "comments" ("post_id");'),
      ],
    },
    // ...older migrations stay, untouched
  ],
})
```

Three things must be exact:

- The index name is `"<table>_<column>"`. That's the name the schema generates for `isIndexed`, and the name NitromelonDB uses when it drops and recreates indexes around very large batches. Another name leaves a duplicate index behind.
- `if not exists`, so it's safe on a database that somehow already has it.
- The SQL ends with a semicolon. `unsafeExecuteSql` requires it.

Put several indexes in one migration, one `unsafeExecuteSql` step each.

**b. Mark the column in the schema:**

```js
{ name: 'post_id', type: 'string', isIndexed: true },
```

**c. Bump the schema `version`** to the migration's `toVersion`.

For a **new** column or table, no SQL is needed: put `isIndexed: true` in the `addColumns` / `createTable` step and in the schema.

**To remove an index:** `unsafeExecuteSql('drop index if exists "posts_body";')` in a migration, and remove `isIndexed` from the schema.

**A two-column index** isn't part of the schema format. It needs the `create index` both in a migration (`unsafeExecuteSql`) and in the schema's `unsafeSql` for fresh installs, under a name that doesn't collide with the generated ones. Tell the user it's hand-maintained SQL before adding it.

**LokiJS.** `unsafeExecuteSql` is ignored there. On LokiJS, an index from `isIndexed` is created when the table or column is first created, and existing installs don't get one for a column they already have. If the app ships LokiJS, make the SQLite change as above and tell the user that existing LokiJS databases keep working without the new index.

**Sync.** Index changes don't affect sync. `unsafeExecuteSql` steps are ignored for migration syncs, and no table or column is added.

Never edit or delete an older migration, and never change `isIndexed` in the schema without the matching migration.

### 7. Verify

- Run the app's tests and type checker.
- **Upgrade test:** with the previous build installed and holding data, install the new one. The app must open, and `select name from sqlite_master where type = 'index'` on its database must list the new index.
- **Fresh install test:** remove the app, install the new build. Same check.
- If you measured in step 4, measure again on the migrated database.

Creating an index on a large table takes time at the first launch after the update (roughly proportional to the table size), while the migration runs. For a table with millions of rows, tell the user, and suggest gating the UI on `useDatabaseReady(database)` so a splash screen covers it.

### 8. Summary

List the indexes added and removed, the migration version, the files changed, the measurements if you have them, and which of the two install tests were run and by whom.
