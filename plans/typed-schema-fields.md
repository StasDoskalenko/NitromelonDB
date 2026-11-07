# Plan: Model fields that can't drift from the schema

Status: **proposal / not started**
Owner: TBD
Related in this repo: #182 / #200 (standard decorators, which make the type-level part possible)
User-facing docs today: [Model → TypeScript: `!` and keeping fields in sync with the schema](../docs-website/docs/docs/Model.md)

---

## 1. Goal

A model field's TypeScript type, and the column it reads, should be checked against the schema,
so drift is caught when you write it (compile time) or at the latest when the app starts (dev
runtime). Today neither happens.

**Non-goals:** removing the `!` from model fields (TypeScript can't do that, see §3); generating
models from the schema; changing the runtime representation of records (`_raw` stays as is).

---

## 2. The problem

Model fields are declared with `!` (`@text('title') accessor title!: string`). `!` only says
"something sets this"; the type after it is an unchecked promise. Ways it drifts from the schema,
and what each does at runtime today (checked against `src/Model` and `src/RawRecord`):

| Drift | Runtime behavior today |
| --- | --- |
| Optional column typed without `null` (`accessor subtitle!: string` for `isOptional: true`) | Reads return `null` typed as `string`. Crashes later, far from the cause. |
| Wrong type (`string` field on a `number` column) | Reads return the column's type. Writes of the wrong type are **silently sanitized** to `''` / `0` / `false` (or `null` if optional) by `RawRecord._setRaw`. Silent data loss. |
| Misspelled column (`@field('positon')`) | Reads: `this._raw['positon']` → `undefined`. Writes: `TypeError: Cannot destructure property 'type' of 'columnSchema' as it is undefined.` (cryptic) |
| Column renamed / removed in a migration, model not updated | Same as a misspelled column. |
| Decorator forgotten (`accessor title!: string` alone) | Always `undefined`; nothing touches the database. |

---

## 3. Constraints

- **`!` stays.** With `strictPropertyInitialization`, TypeScript requires fields to be definitely
  assigned and has no way for a decorator to declare that it initializes one (TS2564 in both
  decorator modes; decorators aren't allowed on `declare` fields, TS1206). So the aim is to make
  `!` harmless, not to remove it.
- **Type-level checks need standard decorators.** Standard (2023-11) decorators receive the
  field's type (`ClassAccessorDecoratorContext<This, Value>`), so a decorator's type can reject a
  mismatch. Legacy decorators only see `(target, key)`; they can get the runtime checks (§5.1)
  but not the compile-time ones.
- **Opt-in, no breaking change.** Apps that don't register their schema type keep today's loose
  types.
- **The schema object loses its literal types today.** `appSchema()` / `tableSchema()` return
  `AppSchema` / `TableSchema`, so column names, types and `isOptional` aren't visible to the type
  system.

---

## 4. Prototype (type level)

Checked with TypeScript 6 and standard decorators (`examples/typescript`, `experimentalDecorators`
off). Valid fields pass; all three mistakes are compile errors:

```ts
type Col = { type: 'string' | 'number' | 'boolean'; isOptional?: boolean }
type JsType<C extends Col> =
  | (C['type'] extends 'string' ? string : C['type'] extends 'number' ? number : boolean)
  | (C['isOptional'] extends true ? null : never)
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

declare function field<T extends keyof Schema, C extends keyof Schema[T]>(
  table: T,
  column: C,
): <This, V>(
  value: ClassAccessorDecoratorTarget<This, V>,
  context: ClassAccessorDecoratorContext<This, V>,
) => Same<V, JsType<Schema[T][C] & Col>> extends true
  ? void
  : { error: 'field type must match the column'; expected: JsType<Schema[T][C] & Col>; got: V }

class Post {
  @field('posts', 'title') accessor title!: string // ok
  @field('posts', 'subtitle') accessor subtitle!: string | null // ok (optional column)
  @field('posts', 'subtitle') accessor a!: string // TS1270: expected string | null, got string
  @field('posts', 'rank') accessor b!: string // TS1270: expected number, got string
  @field('posts', 'ttile') accessor c!: string // TS2345: '"ttile"' not in '"title" | "subtitle" | "rank"'
}
```

Notes from the prototype:

- Constraining the context's `Value` alone isn't enough: TypeScript accepts `string` where
  `string | null` is expected (the context type is checked bivariantly). The exact-match check
  has to go through the decorator's **return type**. The error message then names the expected
  and actual types, which is readable.

---

## 5. Design

### 5.1 Phase 0: loud at runtime (both decorator modes, no type changes)

Cheap, and it helps legacy-decorator apps too:

- **Unknown column on write:** replace the `TypeError` from `RawRecord._setRaw` with an error
  naming the model, field, table and column (`Post.typo writes column "positon", which isn't in
  the "posts" table schema`).
- **Validate models at startup in development:** decorators record `{ key, column, decorator }`
  per class (legacy: on `target.constructor`; standard: `context.metadata` where available,
  otherwise an initializer that registers once per class). `new Database()` then checks every
  model class against the schema in development: unknown columns, and decorator/column type
  mismatches (`@text` on a `number` column, `@date` on a `string` column).
- **Wrong-type writes in development:** warn once per field when `_setRaw` sanitizes a value of
  the wrong type to the empty value, instead of doing it silently. (Production keeps today's
  behavior.)

### 5.2 Phase 1: keep the schema's literal types

Make `appSchema` / `tableSchema` generic with `const` type parameters, so
`typeof schema` carries table names, column names, types and `isOptional`. No runtime change.
Check that existing usages (and `schemaMigrations` / `addColumns`) still type-check.

### 5.3 Phase 2: register the schema and type the decorators

- Register once, like TanStack Router's `Register` interface:
  `declare module 'nitromelondb' { interface Register { schema: typeof schema } }`.
  Without it, decorators keep today's loose types.
- Type `@field` / `@text` / `@date` with the exact-match return type from §4. `@json` checks the
  column is a `string` and takes its type from the sanitizer. `@relation` / `@immutableRelation`
  check the id column exists (and is `string`, or `string | null` if optional). `@children`
  checks the table has a `has_many` association.

**Open question: how a field knows its table.** `@field('posts', 'title')` repeats the table on
every field. A decorator's type sees the instance type (`This`), not the class's static
`table`. Options:

| Option | Looks like | Notes |
| --- | --- | --- |
| A. Table on every field | `@field('posts', 'title')` | Simplest; verbose. |
| B. Per-table helper | `const posts = columnsOf('posts')` then `@posts.field('title')` | One extra line per model; reads well. |
| C. Generic base class | `class Post extends Model.for('posts')` | No per-field cost; changes how models are declared, and the helper must keep `static table` in sync. |

Leaning to B, with A as the underlying API.

### 5.4 Phase 3: catch a missing decorator

An ESLint rule (`nitromelondb/no-undecorated-model-field`): in a class extending `Model`, flag
fields with `!` (or `accessor` fields) that have no NitromelonDB field decorator.

---

## 6. Risks

- **Type-check cost** on large schemas (conditional types per field). Measure with a schema of
  ~100 tables.
- **TypeScript version floor:** `const` type parameters need TS 5.0+, which standard decorators
  already require.
- **Error readability:** keep the return-type error object short; test the messages with `tsc`
  and in VS Code.
- **Phase 0's development checks** must stay out of production bundles and cost nothing there.
