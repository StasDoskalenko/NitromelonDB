---
name: nitromelondb-schema
description: >
  Use to design or change the database schema of an app that uses
  NitromelonDB (nitromelondb): working out tables, columns and relations from
  the app's own types, API responses and stored state; one-to-many,
  many-to-many and JSON fields; indexes; what to keep out of the database;
  getting ready for sync; and every later change (new tables and columns)
  with its migration and version bump. Writes schema.ts, migrations, typed
  models and the modelClasses list, and tests a fresh install and an
  upgrade. Invoke with `/nitromelondb-schema`.
license: MIT
metadata:
  author: StasDoskalenko
  version: 0.1.0
---

# Design and change a NitromelonDB schema

The schema decides how fast the app can be and what it can change later without losing data. Columns can't be renamed or removed by a migration, so a name is forever once it ships. This skill gets the first version right, and makes every later change safely.

References (plain Markdown): [Schema](https://stasdoskalenko.github.io/NitromelonDB/docs/Schema.md), [Model](https://stasdoskalenko.github.io/NitromelonDB/docs/Model.md), [Relations](https://stasdoskalenko.github.io/NitromelonDB/docs/Relation.md), [Migrations](https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/Migrations.md), [Building a fast app](https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/Performance.md). Full index: https://stasdoskalenko.github.io/NitromelonDB/llms.txt

**Propose first.** Steps 1 to 4 change nothing. Show the proposed schema (step 4) and get the user's go-ahead before writing files.

## Step-by-step procedure

### 1. Find out where the app stands

- **Is `nitromelondb` installed?** If not, use the `nitromelondb-install` skill first (it calls this one for the schema). If the app is on `@nozbe/watermelondb`, use `nitromelondb-migrate-from-watermelondb` first.
- **Is there a schema already?** Find `appSchema(`, its `version`, the `schemaMigrations(` list and every `Model` subclass.
- **Has that version shipped?** Look for release tags, store build numbers, a `CHANGELOG`, or ask. This decides the path in step 6:
  - **Not shipped** (new app, or a schema only on developers' devices): change the schema freely, keep `version: 1`.
  - **Shipped:** every change is a migration plus a version bump. Nothing already shipped is edited.
- **Adapter:** `SQLiteAdapter` (iOS, Android, Windows, Node, Expo web) or `LokiJSAdapter` (web without Expo). LokiJS ignores raw SQL and only builds indexes when a table or column is created.
- **Sync:** does the app call `synchronize()`, or will it? Synced tables must match the backend's (step 3, "Sync").

### 2. Collect what the app stores

Read the app, not just what the user says. Sources, in order of how much they tell you:

- TypeScript types and interfaces for domain objects (`type Task = {...}`), and Zod / Yup schemas.
- API clients and their response types, OpenAPI or GraphQL schemas, and the backend's database schema if it's in reach (for a synced app, this is the source of truth).
- Persisted client state: Redux / Zustand / MobX stores with persistence, MMKV, AsyncStorage, SecureStore keys, existing SQLite tables.
- Screens: what lists show, how they're sorted and filtered, what's searched, what's counted. This decides indexes and sort columns.

List the entities, their fields, how they relate, and for each list on screen: its filter, sort, and how many rows it can reach (tens, thousands, hundreds of thousands).

### 3. Model it

**What doesn't go in the database:**

- Secrets and tokens: Keychain / SecureStore.
- Large binary data (images, audio, PDFs): files on disk, with the path or URL in a `string` column.
- UI state that doesn't outlive the session (an open modal, a text field's draft unless the app restores drafts).
- A handful of app-wide values (the logged-in user's id, last screen): `database.localStorage` with fixed keys, not a table.
- Data the app only shows and never queries, that comes fresh from the network each time: consider leaving it as a fetch.

**Tables.** One table per entity. Names are plural, `snake_case`: `tasks`, `project_members`. Every table has `id` (string), `_status` and `_changed` already: never declare them.

**Columns.** Only three types exist: `string`, `number`, `boolean`. Map everything onto them:

| Data | Column | Model field |
| --- | --- | --- |
| Text | `string` | `@text('title') title!: string` (trims whitespace) |
| Machine string (code, slug, external id) | `string` | `@field('slug') slug!: string` |
| Whole number, count, position | `number` | `@field('position') position!: number` |
| Money | `number`, in cents (integer) | `@field('price_cents')` |
| Boolean | `boolean`, named `is_...` / `has_...` | `@field('is_done') isDone!: boolean` |
| Date and time | `number`, named `..._at` | `@date('due_at') dueAt!: Date \| null` |
| Enum | `string` holding the value (`'todo'`, `'done'`) | `@field('status') status!: TaskStatus` |
| Relation to one record | `string`, named `<singular>_id` | `@relation('projects', 'project_id') project!: Relation<Project>` |
| Small structured value that's only read whole (settings, a list of tags shown as chips) | `string` | `@json('settings', sanitizeSettings) settings!: Settings` |
| A list you filter, sort, count or sync item by item | **a separate table** | `@children('comments') comments!: Query<Comment>` |

- `isOptional: true` only for a value that can really be missing. The field type then includes `| null`. Non-optional columns default to `''`, `0` or `false`.
- `@json` needs a sanitizer that returns a valid value for any input (including `null` and garbage from an old version). Never query inside JSON.
- `created_at` / `updated_at` (`number`) are filled in automatically when declared, with `@readonly @date(...)` fields. Add them where the UI shows or sorts by them.
- `@readonly` for fields the app never assigns (`created_at` / `updated_at`, which are filled in for it), `@nochange` for fields set at creation that must never change afterwards, `@immutableRelation` for a relation that never moves (a comment's post).
- Values computed from other fields are getters on the model, not columns. A computed value the UI needs on many rows at once (a count of children shown in a list) can be a stored column the app keeps up to date in the same `batch()` as the change, when the per-row query would cost more.

**Relations.**

- **One-to-many:** the child table has `<parent>_id` (`isIndexed: true`). Declare both sides: the parent's `static associations = { comments: { type: 'has_many', foreignKey: 'post_id' } }`, the child's `{ posts: { type: 'belongs_to', key: 'post_id' } }`. `has_many` takes `foreignKey`, `belongs_to` takes `key`.
- **Many-to-many:** a pivot table (`post_tags` with `post_id` and `tag_id`, both indexed), `has_many` from each side to the pivot, `belongs_to` from the pivot to each side, `@immutableRelation` on the pivot's two fields, and a `@lazy` getter that queries through the pivot with `Q.on('post_tags', 'post_id', this.id)`.
- **Deleting a parent:** if children must go with it, override `markAsDeleted()` / `destroyPermanently()` on the parent to delete them in the same batch, or do it in the writer that deletes the parent.

**Indexes.** `isIndexed: true` on relation (`_id`) columns that are queried (nearly all of them), and on columns looked up by equality that have many distinct values (an external id, a slug). Not on long text, not on booleans where half the rows match, not on columns only sorted by. For a list sorted by a column and paged with `Q.take` on a large table, an index may help: leave it out now, and use the `nitromelondb-indexes` skill once there's real data to measure.

**Lists that grow.** For a list that can reach thousands of rows, make sure the schema has the column it sorts by (`position`, `created_at`, `rank`), so the query can page with `Q.sortBy` + `Q.take` instead of loading everything.

**Heavy columns.** If a list shows a few small columns of a table that also holds large text (a note's full body, a message's HTML), and the list can get long, consider a second table for the heavy part (`note_bodies` with `note_id`). A query loads whole rows.

**Sync.** If the app syncs, or will:

- Table and column names are the sync protocol: the backend must use the same ones (or map them). Agree on them with whoever owns the backend.
- IDs: records created on the device get random 16-character ids. If the backend assigns its own ids, it must accept the device's ids for records created offline. If records come from an existing backend with other ids (numbers, UUIDs), store them in the `id` as strings when the backend can accept that, otherwise in a separate indexed `remote_id` column.
- Every table goes through push. A table that must never leave the device needs the backend to ignore it (its whitelist).
- Deletes the user makes are `markAsDeleted()`, so they sync. Plan for it.
- From the first release, `synchronize()` gets `migrationsEnabledAtVersion` (see the `nitromelondb-sync` skill).

### 4. Propose

Show the user, before writing anything:

- Each table with its columns (name, type, optional, indexed) and one line on why it exists.
- The relations, and which side declares what.
- What you left out of the database and where it goes instead.
- The lists the schema is built for: filter, sort, expected size, and the index or sort column that serves it.
- For a shipped app: the migration (step 6), and that a fresh install and an upgrade will be tested.

Ask about anything you had to guess (expected sizes, whether a list syncs, which ids the backend uses). Go on after the user agrees.

### 5. Write it (new schema, not shipped)

Put the files where the app keeps its database code (`src/db/` for example): `schema.ts`, `migrations.ts`, `model/<Model>.ts`, and the `Database` module.

```ts
// schema.ts
import { appSchema, tableSchema } from 'nitromelondb'

export default appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'projects',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'position', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'tasks',
      columns: [
        { name: 'project_id', type: 'string', isIndexed: true },
        { name: 'title', type: 'string' },
        { name: 'status', type: 'string' },
        { name: 'due_at', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
      ],
    }),
  ],
})
```

```ts
// migrations.ts: empty, but passed to the adapter from day one
import { schemaMigrations } from 'nitromelondb/Schema/migrations'

export default schemaMigrations({ migrations: [] })
```

```ts
// model/Task.ts
import { Model, type Relation } from 'nitromelondb'
import type { Associations } from 'nitromelondb/Model'
import { field, text, date, readonly, relation, writer } from 'nitromelondb/decorators'
import type Project from './Project'

export type TaskStatus = 'todo' | 'doing' | 'done'

export default class Task extends Model {
  static table = 'tasks'
  static associations: Associations = {
    projects: { type: 'belongs_to', key: 'project_id' },
  }

  @text('title') title!: string
  @field('status') status!: TaskStatus
  @date('due_at') dueAt!: Date | null
  @readonly @date('created_at') createdAt!: Date
  @relation('projects', 'project_id') project!: Relation<Project>

  get isOverdue() {
    return this.status !== 'done' && this.dueAt !== null && this.dueAt.getTime() < Date.now()
  }

  @writer async markDone() {
    await this.update((task) => {
      task.status = 'done'
    })
  }
}
```

- Field names `camelCase`, column names `snake_case`, `!` on every field in TypeScript.
- Every column of the schema has a field, with the matching decorator and type, and `| null` exactly where the column is optional. Nothing checks this for you.
- Associations on both sides, keyed by the other table's name.
- Domain writes that belong to one record are `@writer` methods on its model. Writes that span tables can be `@writer` methods on the parent, or plain functions that open one `database.write()`.
- Add every model to `modelClasses` in `new Database({ ... })`.
- If the app uses standard decorators (`accessor` on existing fields), declare new fields with `accessor` too.

While it isn't shipped, change this schema freely at `version: 1`, and reinstall the app (or clear its data) after each change.

### 6. Change a shipped schema

Every change is: **a migration one version up, the same change in the schema, the version bump**, in that order, together.

| Change | Migration step | Schema |
| --- | --- | --- |
| New table | `createTable({ name, columns })` | the same `tableSchema` |
| New column | `addColumns({ table, columns })` | the same column |
| Index on an existing column | `unsafeExecuteSql('create index if not exists "<table>_<column>" on "<table>" ("<column>");')` | `isIndexed: true` (the `nitromelondb-indexes` skill covers this) |
| Remove a table | `destroyTable({ table })` | remove the table and its model |
| Rename a column, change its type, remove it | **not possible** | add a new column (migration as above), move the code to it, and stop using the old one: remove it from the model, and leave it in the schema. If older app versions still sync, have the backend fill both for a while |

```ts
import { schemaMigrations, createTable, addColumns } from 'nitromelondb/Schema/migrations'

export default schemaMigrations({
  migrations: [
    {
      toVersion: 3,
      steps: [
        createTable({
          name: 'tags',
          columns: [{ name: 'name', type: 'string' }],
        }),
        addColumns({
          table: 'tasks',
          columns: [{ name: 'priority', type: 'number' }],
        }),
      ],
    },
    // older migrations stay below, unchanged
  ],
})
```

- Columns added to an existing table get the type's default (`''`, `0`, `false`, or `null` if optional) on existing rows. If old rows need real values, backfill them: on SQLite, an `unsafeExecuteSql('update "tasks" set "priority" = 1 where ...;')` step in the same migration (ignored on LokiJS and by migration syncs); otherwise a one-time writer after launch, guarded by a `database.localStorage` key so it runs once. Don't use a `seed` step for it: on an install that never had `seed`, every seed step runs, demo data included.
- `isIndexed: true` in `addColumns` / `createTable` creates the index for new columns and tables. No raw SQL needed.
- Never edit or delete a migration that shipped. Never lower `version`: a database newer than the schema is wiped.
- New fields on models, new models in `modelClasses`.
- **Sync:** new tables and columns are pulled in full on the next sync by apps that pass `migrationsEnabledAtVersion` (if the backend implements migration syncs). Update the backend's table and column whitelist in the same release, before the app ships.

### 7. Check it

1. Type checker, linter and tests.
2. **A write and read per model**, in a test or a scratch spot: create a record of each model with every field set, read it back, and compare. A field that reads `undefined` or the wrong type means a decorator, column name or type doesn't match. In Jest, use the in-memory adapter from the `nitromelondb-install` skill (a `jest.mock` of `nitromelondb/adapters/sqlite` with `LokiJSAdapter`).
3. **Shipped app, after a migration:**
   - **Upgrade:** install the previous build, create data that touches the changed tables, install the new build. The app opens, the data is there, and the new columns and tables work.
   - **Fresh install:** delete the app, install the new build. Same checks.
   - Both must give the same database. Check with `sqlite3` on a copy of each file (`.schema <table>`), see the `nitromelondb-indexes` skill for where the file is.
4. If a migration fails during development, the database stays on the old version and `onSetUpError` is called. Fix the migration (it hasn't shipped), and run the app again.

### 8. Report

- The tables, columns, relations and indexes, with one line each on what they serve.
- What stays out of the database, and where.
- The schema version, the migration (if any), and the files changed.
- What was tested: the write and read per model, the upgrade and fresh install (or that they're left to the user).
- For synced apps: what the backend must change, in the same release.
- Next: `nitromelondb-indexes` once tables hold real data, `nitromelondb-sync` to add sync, `nitromelondb-audit` for the rest.

## Checklist

- [ ] Proposed and agreed before writing
- [ ] Plural `snake_case` tables, `snake_case` columns, `_id` relations, `is_` booleans, `_at` dates, no `id` / `_status` / `_changed`
- [ ] Lists that are queried item by item are tables, not `@json`; `@json` has a sanitizer
- [ ] `isIndexed` on queried `_id` columns and equality lookups, nothing else
- [ ] Associations on both sides; many-to-many through an indexed pivot table
- [ ] Every column has a field with the right decorator, type and `| null`; every model in `modelClasses`
- [ ] `migrations` passed to the adapter; shipped app: migration + schema + version together, nothing old edited
- [ ] A write and read per model; after a migration, upgrade and fresh install both checked
- [ ] Sync: names and ids agreed with the backend, whitelist updated in the same release
