---
title: Decorators
description: "NitromelonDB recommends standard (TC39 2023-11) decorators with the accessor keyword. Legacy decorators keep working; here's how to set them up, migrate one model at a time, or let a coding agent do it."
---

# Decorators: standard and legacy

JavaScript has two versions of decorators:

- **Standard decorators**, the TC39 proposal that's becoming part of JavaScript (Babel's `version: '2023-11'`). TypeScript 5+ uses them when `experimentalDecorators` is off. **NitromelonDB recommends them**, and [Installation](../Installation.mdx) sets them up.
- **Legacy decorators**, which TypeScript calls `experimentalDecorators` and Babel calls `legacy: true`. WatermelonDB used them. They keep working, so existing models don't have to change.

Every NitromelonDB decorator accepts both.

Why standard decorators? They're the version JavaScript is standardizing, so tools keep supporting them. They need less Babel setup: legacy decorators depend on a fixed plugin order that has broken more than once as React Native and Babel changed (most recently on Expo SDK 56 and React Native 0.87). And they're what TypeScript 5+ uses by default.

## Set them up

Follow [Installation](../Installation.mdx) for your platform. In short:

- **Expo:** `presets: [['babel-preset-expo', { decorators: { version: '2023-11' } }]]`
- **Bare React Native:** `@babel/plugin-proposal-decorators` with `version: '2023-11'`, plus `@babel/plugin-transform-class-static-block`
- **Web (Webpack, Vite):** `@babel/plugin-proposal-decorators` with `version: '2023-11'`
- **TypeScript:** 5.0 or newer, with `experimentalDecorators` off

The setting applies to the whole app, including decorators from other libraries. If you use one that only supports legacy decorators (some versions of MobX, TypeORM or class-validator, for example), use [legacy decorators](#legacy-decorators) until it supports standard ones.

The [example apps](https://github.com/StasDoskalenko/NitromelonDB/tree/master/examples/NotesApp) use standard decorators.

## Models

With standard decorators, a decorator can't turn a plain class field into a getter and setter, which is how model fields read and write the database. The `accessor` keyword gives it one:

```ts
class Post extends Model {
  static table = 'posts'

  @text('title') accessor title!: string
  @readonly @date('created_at') accessor createdAt!: Date
  @children('comments') accessor comments!: Query<Comment>
}
```

| Decorator | With standard decorators |
| --- | --- |
| `@field`, `@text`, `@date`, `@json` | `@field('name') accessor name` |
| `@relation`, `@immutableRelation`, `@children` | `@relation('blogs', 'blog_id') accessor blog` |
| `@nochange`, `@readonly` | Before the field decorator: `@readonly @date('created_at') accessor createdAt` |
| `@writer`, `@reader`, `@action` | On methods, as always: `@writer async rename(name) { ... }` |
| `@lazy` | On a getter: `@lazy get recentComments() { return this.comments.extend(...) }` |
| `@experimentalFailsafe` | Legacy decorators only, for now |

Values live in the record's raw data, so change tracking, sync and observation work the same in both modes.

### `@lazy`

Use `@lazy` on a getter. It runs the getter the first time it's read and keeps the result:

```js
class Post extends Model {
  @children('comments') accessor comments

  @lazy get verifiedComments() {
    return this.comments.extend(Q.where('is_verified', true))
  }
}
```

The getter form works with legacy decorators too. With standard decorators, `@lazy` on a field (`@lazy verified = ...`) can't be lazy: a field's initializer runs while the record is being built, before the decorator could defer it. It's still computed only once, and development builds log a warning.

## Legacy decorators

Keep legacy decorators if you have models written for them, for example from WatermelonDB, or a library that needs them. Write models without `accessor`, and with `@lazy` on fields or getters.

**Expo:** use the preset without the `decorators` option. `babel-preset-expo` enables legacy decorators by default. Don't add `@babel/plugin-proposal-decorators` to `plugins`: since SDK 56 it runs before the preset's own plugins and fails on fields declared with `!`.

```js
// babel.config.js
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
  }
}
```

**Bare React Native:** four plugins, in this order, with these options. With React Native 0.87 and newer, the decorators plugin alone fails on fields like `@field('amount') amount!: number` with `Definitely assigned fields cannot be initialized here, but only in the constructor`.

```bash
yarn add --dev @babel/plugin-proposal-decorators @babel/plugin-transform-class-properties @babel/plugin-transform-private-methods @babel/plugin-transform-private-property-in-object
```

```js
// babel.config.js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    ['@babel/plugin-proposal-decorators', { legacy: true }],
    ['@babel/plugin-transform-class-properties', { loose: true }],
    ['@babel/plugin-transform-private-methods', { loose: true }],
    ['@babel/plugin-transform-private-property-in-object', { loose: true }],
  ],
}
```

**Web (Webpack, Vite):** the decorators plugin first, then class properties in `loose` mode:

```json
{
  "plugins": [
    ["@babel/plugin-proposal-decorators", { "legacy": true }],
    ["@babel/plugin-transform-class-properties", { "loose": true }]
  ]
}
```

**TypeScript:** turn on `experimentalDecorators` in `tsconfig.json`.

## Moving from legacy to standard decorators

1. Change the Babel config to the standard one in [Installation](../Installation.mdx), and turn off `experimentalDecorators`.
2. Restart the bundler with a cleared cache (`npx expo start --clear` or `npx react-native start --reset-cache`).
3. Add `accessor` to model fields, and move `@lazy` fields to getters.

Step 1 switches every file at once, because Babel compiles the whole app with one decorators version (and the legacy plugin can't parse `accessor`). Models you haven't updated yet keep working: plain fields get their getter and setter on each record when the record is created, instead of once on the class. That's slower, about 2 µs per record with five fields in a Node benchmark (about 100 ms for 50,000 records), so development builds log a warning once per field, naming the field that needs `accessor`. You can update models one at a time, starting with the tables you load the most records from.

To let a coding agent do the switch, copy the prompt from the migration guide: [Let a coding agent do it](../Migrating.md#let-a-coding-agent-do-it).

## Things that behave differently

- **Enumerating fields:** an `accessor` field is a non-enumerable property of the class, so it doesn't appear in a `for...in` loop over a record, while legacy fields do. `Object.keys(record)` and `JSON.stringify(record)` don't include fields in either mode.
- **Default values:** model fields can't have a default value in either mode. With standard decorators the error comes when a record is created, not when the class is defined.
- **`@readonly` on a method** works only with legacy decorators.
