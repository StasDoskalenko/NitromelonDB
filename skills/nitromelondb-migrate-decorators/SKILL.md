---
name: nitromelondb-migrate-decorators
description: >
  Use when moving a NitromelonDB app's models from legacy decorators
  (experimentalDecorators, Babel `legacy: true`) to standard TC39 2023-11
  decorators. Updates the Babel config and tsconfig, adds `accessor` to every
  decorated model field, and turns `@lazy` fields into getters. Checks first
  that no other library in the app still needs legacy decorators. Invoke with
  `/nitromelondb-migrate-decorators`.
license: MIT
metadata:
  author: StasDoskalenko
  version: 0.1.0
---

# Migrate NitromelonDB models to standard decorators

Every NitromelonDB decorator works with both versions of decorators. Legacy decorators are the default and keep working, so this migration is optional. Standard decorators are the version TypeScript 5+ uses when `experimentalDecorators` is off.

Reference (plain Markdown): https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/StandardDecorators.md

## Step-by-step procedure

### 1. Check that the whole app can switch

The decorators version applies to the whole app: Babel compiles every file with one version.

- Search the app's source and `package.json` for decorators from other libraries (MobX, TypeORM, class-validator, class-transformer, Angular, InversifyJS, and any `@something` on a class or member that isn't from `nitromelondb/decorators`).
- For each one, check whether the installed version supports standard (2023-11) decorators.
- Search for `@experimentalFailsafe`. It only supports legacy decorators so far.

If a library only supports legacy decorators, **stop and tell the user before changing anything**. The app has to stay on legacy decorators until that library supports standard ones.

Also check that TypeScript, if used, is **5.0 or newer**. If it's older, stop and say so.

### 2. Babel config

**Expo** (`babel-preset-expo`): pass the version to the preset, and remove `@babel/plugin-proposal-decorators` from `plugins` if it's there.

```js
// babel.config.js
module.exports = function (api) {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { decorators: { version: '2023-11' } }]],
  }
}
```

**Bare React Native** (`@react-native/babel-preset`): replace the legacy decorators plugin and the class-properties, private-methods and private-property-in-object plugins that came with it. Add `@babel/plugin-transform-class-static-block` as a dev dependency.

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

**Web (Webpack with Babel):** the decorators plugin, and if Babel also compiles the TypeScript, the TypeScript plugin first. Don't use `@babel/preset-typescript` for that: presets run after plugins, which breaks plain fields declared with `!`. For browsers older than Safari 16.4, also add `@babel/plugin-transform-class-static-block`.

```json
{
  "plugins": [
    ["@babel/plugin-transform-typescript", { "allowDeclareFields": true }],
    ["@babel/plugin-proposal-decorators", { "version": "2023-11" }]
  ]
}
```

**Vite:** pass `['@babel/plugin-proposal-decorators', { version: '2023-11' }]` to `@vitejs/plugin-react`'s `babel.plugins`.

Keep other plugins the app has. If Jest uses a separate Babel config, update it the same way.

### 3. TypeScript config

In every `tsconfig` that compiles model files, remove `experimentalDecorators` and `emitDecoratorMetadata`. Check configs that `extends` another one: the option may come from the parent.

### 4. Add `accessor` to model fields

In every class that extends `Model` from `nitromelondb`, add the `accessor` keyword to each property decorated with `@field`, `@text`, `@date`, `@json`, `@relation`, `@immutableRelation`, `@children`, `@nochange` or `@readonly`.

Keep the decorators, their arguments and their order. Keep the `!` and the type annotation.

```ts
// before
@text('title') title!: string
@readonly @date('created_at') createdAt!: Date
@children('comments') comments!: Query<Comment>

// after
@text('title') accessor title!: string
@readonly @date('created_at') accessor createdAt!: Date
@children('comments') accessor comments!: Query<Comment>
```

Find the models through `modelClasses` in `new Database({ ... })`, and through subclasses of the app's own base model class if it has one.

### 5. Turn `@lazy` fields into getters

A field initializer can't be deferred with standard decorators. A getter stays lazy:

```ts
// before
@lazy recent = this.comments.extend(Q.take(5))

// after
@lazy get recent() {
  return this.comments.extend(Q.take(5))
}
```

### 6. Leave these alone

- `@writer`, `@reader` and `@action` methods: no change.
- `@experimentalFailsafe`: don't change it, and tell the user (step 1 should have caught it).
- `@readonly` on a method works only with legacy decorators. If you find one, tell the user.
- `node_modules`, `dist`, and generated files.
- Fields with a default value (`@field('x') accessor x = 1`): model fields can't have defaults in either mode. Report it, don't work around it.

### 7. Verify

- Restart the bundler with a cleared cache (`npx expo start --clear`, or `npx react-native start --reset-cache`). Check first whether a bundler is already running, and restart that one.
- Run the type checker and the tests.
- In development, NitromelonDB logs a warning naming each model field that still needs `accessor`. Fix those too.

Common errors:

- `Support for the experimental syntax 'decoratorAutoAccessors' isn't currently enabled`: a Babel config still compiles legacy decorators (often Jest's, or a second `babel.config.js` in a monorepo package).
- `Definitely assigned fields cannot be initialized here`: Babel's plugins are in the wrong order. Use the configs from step 2 exactly.
- Fields read `undefined`, with a dev error "decorators aren't working": TypeScript or esbuild compiles the models with `useDefineForClassFields` on. Set `"useDefineForClassFields": false`.

### 8. Report

List the files you changed, the number of fields that got `accessor`, the `@lazy` fields you rewrote, and anything you couldn't migrate.

Mention one behavior change: an `accessor` field isn't enumerable, so it doesn't appear in a `for...in` loop over a record (legacy fields do). `Object.keys(record)` and `JSON.stringify(record)` don't include fields in either mode.

## Doing it in stages

After step 2, models that don't have `accessor` yet keep working: their fields get a getter and setter on each record when it's created, instead of once on the class. That's slower (about 2 µs per record with five fields), and development builds warn once per field. So for a large app you can do steps 2 and 3 first, then update models in several changes, starting with the tables that load the most records.

## Going back

Restore the legacy Babel config and `experimentalDecorators`, remove `accessor` from model fields, and clear the bundler cache. The legacy plugin can't parse `accessor`, so the two can't be mixed in that direction.
