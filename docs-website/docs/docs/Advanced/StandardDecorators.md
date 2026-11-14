---
title: Decorators
description: "NitromelonDB models work with legacy decorators (the default, no Babel setup on Expo) and with standard TC39 decorators and the accessor keyword. Setup for both, moving between them, and what to do when decorators don't work."
---

# Decorators: legacy and standard

JavaScript has two versions of decorators, and every NitromelonDB decorator works with both:

- **Legacy decorators**, which TypeScript calls `experimentalDecorators` and Babel calls `legacy: true`. WatermelonDB used them, and **they're the default for now**: on Expo they need no Babel setup at all, and the rest of these docs use them.
- **Standard decorators**, the TC39 proposal that's becoming part of JavaScript (Babel's `version: '2023-11'`). TypeScript 5+ uses them when `experimentalDecorators` is off. They need a small Babel setting, and fields are declared with `accessor`.

## The default: legacy decorators

Follow [Installation](../Installation.mdx). In short:

- **Expo:** nothing to set up. `babel-preset-expo` enables legacy decorators by default, so you don't need a `babel.config.js` for them. Don't add `@babel/plugin-proposal-decorators` yourself: since SDK 56 it runs before the preset's own plugins and breaks fields declared with `!`.
- **Bare React Native:** four Babel plugins in a fixed order (see [Installation](../Installation.mdx#react-native-bare)).
- **Web (Webpack, Vite):** the decorators plugin and class properties in `loose` mode.
- **TypeScript:** `experimentalDecorators: true`.

Models declare fields as plain properties:

```ts
class Post extends Model {
  static table = 'posts'

  @text('title') title!: string
  @readonly @date('created_at') createdAt!: Date
  @children('comments') comments!: Query<Comment>
}
```

## Standard decorators

Standard decorators work too. Turn them on with your platform's setting below, and declare model fields with `accessor`. The [examples](#models-with-standard-decorators) below show the model side.

The setting applies to the whole app, including decorators from other libraries, so if you use one that only supports legacy decorators (some versions of MobX, TypeORM or class-validator, for example), stay on legacy decorators.

**Expo:** pass the version to the preset.

```js
// babel.config.js
module.exports = function (api) {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { decorators: { version: '2023-11' } }]],
  }
}
```

**Bare React Native:** two plugins instead of the four legacy ones.

```bash
yarn add --dev @babel/plugin-proposal-decorators @babel/plugin-transform-class-static-block
```

```js
// babel.config.js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    ['@babel/plugin-proposal-decorators', { version: '2023-11' }],
    '@babel/plugin-transform-class-static-block',
  ],
}
```

**Web (Webpack):** the decorators plugin, and if Babel also compiles your TypeScript, the TypeScript plugin first. (With `@babel/preset-typescript` instead, presets run after plugins, which breaks plain fields declared with `!`.) For browsers older than Safari 16.4, also add `@babel/plugin-transform-class-static-block`.

```json
{
  "plugins": [
    ["@babel/plugin-transform-typescript", { "allowDeclareFields": true }],
    ["@babel/plugin-proposal-decorators", { "version": "2023-11" }]
  ]
}
```

**Vite:** pass `['@babel/plugin-proposal-decorators', { version: '2023-11' }]` to `@vitejs/plugin-react`'s `babel.plugins`. Vite compiles TypeScript itself, so that's all it needs.

**TypeScript:** 5.0 or newer, with `experimentalDecorators` (and `emitDecoratorMetadata`) off.

### Models with standard decorators

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

## `@lazy`

Use `@lazy` on a getter. It runs the getter the first time it's read and keeps the result, in both modes:

```js
class Post extends Model {
  @children('comments') comments

  @lazy get verifiedComments() {
    return this.comments.extend(Q.where('is_verified', true))
  }
}
```

With legacy decorators, `@lazy` on a field (`@lazy verified = this.comments.extend(...)`) is lazy too. With standard decorators it can't be: a field's initializer runs while the record is being built, before the decorator could defer it. It's still computed only once, and development builds log a warning.

## Moving to standard decorators

1. Change the Babel config to the standard one above, and turn off `experimentalDecorators`.
2. Restart the bundler with a cleared cache (`npx expo start --clear` or `npx react-native start --reset-cache`).
3. Add `accessor` to model fields, and move `@lazy` fields to getters.

Step 1 switches every file at once, because Babel compiles the whole app with one decorators version (and the legacy plugin can't parse `accessor`). Models you haven't updated yet keep working: plain fields get their getter and setter on each record when the record is created, instead of once on the class. That's slower, about 2 µs per record with five fields in a Node benchmark (about 100 ms for 50,000 records), so development builds log a warning once per field, naming the field that needs `accessor`. You can update models one at a time, starting with the tables you load the most records from.

### Let a coding agent do it

The switch is packaged as an [agent skill](../AgentSkills.md). From the root of your app:

```bash
npx skills add StasDoskalenko/NitromelonDB --skill nitromelondb-migrate-decorators
```

Then ask your agent (Claude Code, Cursor, Codex, ...) to move the models to standard decorators, or run `/nitromelondb-migrate-decorators`.

Or, without installing anything, copy this prompt into your coding agent:

```text
Migrate this app's NitromelonDB models from legacy decorators to standard (TC39 2023-11)
decorators. Reference: https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/StandardDecorators

0. First, check whether the app uses decorators from any other library (for example MobX,
   TypeORM, class-validator, Angular). The decorators mode applies to the whole app. If another
   library only supports legacy/experimental decorators, stop and tell me before changing anything.

1. Babel config:
   - Expo (babel-preset-expo): set the preset option `decorators: { version: '2023-11' }`, as in
     presets: [['babel-preset-expo', { decorators: { version: '2023-11' } }]]
     and remove @babel/plugin-proposal-decorators from `plugins` if it's there.
   - Bare React Native (@react-native/babel-preset): replace @babel/plugin-proposal-decorators
     ({ legacy: true }) and the class-properties, private-methods and private-property-in-object
     plugins with:
       ['@babel/plugin-proposal-decorators', { version: '2023-11' }],
       '@babel/plugin-transform-class-static-block',
     and add @babel/plugin-transform-class-static-block as a dev dependency.

2. TypeScript: remove `experimentalDecorators` and `emitDecoratorMetadata` from every tsconfig
   that compiles model files. Make sure TypeScript is 5.0 or newer.

3. In every class that extends Model from 'nitromelondb', add the `accessor` keyword to each
   property decorated with @field, @text, @date, @json, @relation, @immutableRelation, @children,
   @nochange or @readonly. Keep the decorators, their arguments and their order, and keep the `!`
   and the type annotation. Example:
     @text('title') title!: string   ->   @text('title') accessor title!: string
     @readonly @date('created_at') createdAt!: Date   ->   @readonly @date('created_at') accessor createdAt!: Date

4. Turn @lazy fields into getters, which stay lazy with standard decorators:
     @lazy recent = this.comments.extend(Q.take(5))
     ->
     @lazy get recent() { return this.comments.extend(Q.take(5)) }

5. Leave @writer, @reader and @action methods as they are. If anything uses @experimentalFailsafe,
   don't change it and tell me: it only supports legacy decorators so far.

6. Don't touch node_modules or generated files.

7. Restart the bundler with a cleared cache (npx expo start --clear, or
   npx react-native start --reset-cache), then run the type checker and the tests. In development,
   NitromelonDB logs a warning naming any model field that still needs `accessor`. Fix those too.

When you're done, list the files you changed and anything you couldn't migrate.
```

## When decorators don't work

**Fields read `undefined`, with a dev error "decorators aren't working".** In development, NitromelonDB checks the first record of each model class. If a decorated field is also a plain property on the record, that property hides the decorator, so reads return `undefined` and writes never reach the database, with no other error. Two common causes:

- **TypeScript or esbuild compiles your models** (`tsc`, `ts-node`, `ts-jest`, `tsx`, Vite without Babel, Bun) with `useDefineForClassFields` on, which is the default for `ES2022` and newer targets. Set `"useDefineForClassFields": false` in `tsconfig.json`.
- **Babel compiles class fields before the decorators run**, for example a decorators plugin of your own on Expo, or the plugins out of order on bare React Native. Use the setup from [Installation](../Installation.mdx).

**`Support for the experimental syntax 'decoratorAutoAccessors' isn't currently enabled`.** A model uses `accessor`, but the app compiles legacy decorators. Remove `accessor`, or turn on [standard decorators](#standard-decorators).

**`Definitely assigned fields cannot be initialized here, but only in the constructor`.** Babel's plugins run in the wrong order. See [Installation](../Installation.mdx) for your platform.

## Things that behave differently

- **Enumerating fields:** an `accessor` field is a non-enumerable property of the class, so it doesn't appear in a `for...in` loop over a record, while legacy fields do. `Object.keys(record)` and `JSON.stringify(record)` don't include fields in either mode.
- **Default values:** model fields can't have a default value in either mode. With standard decorators the error comes when a record is created, not when the class is defined.
- **`@readonly` on a method** works only with legacy decorators.
