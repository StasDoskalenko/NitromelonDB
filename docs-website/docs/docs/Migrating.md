---
title: Migrating from WatermelonDB
hide_title: true
description: "Move an app from @nozbe/watermelondb to nitromelondb: swap packages and imports, remove the old native setup, update the adapter, and rebuild."
---

# Migrating from WatermelonDB

NitromelonDB is a maintained fork of [WatermelonDB](https://github.com/Nozbe/WatermelonDB). Models, schema, queries, writers, and sync work the same way. What changes is the package name and how the native code is linked.

Your existing SQLite files, schema version, migrations, and models keep working. You swap a library. Your data isn't migrated or touched.

**Before you start:** the app must be on the React Native **New Architecture**, React Native **0.83+**, iOS **15.1+**, and Android **minSdk 24**. The old architecture is not supported.

## 1. Swap the packages

```bash
yarn remove @nozbe/watermelondb @morrowdigital/watermelondb-expo-plugin
yarn add nitromelondb react-native-nitro-modules
```

- Leave out `react-native-nitro-modules` if the app already has it. You need **0.35.2 or newer**.
- If you don't use `@morrowdigital/watermelondb-expo-plugin`, just remove `@nozbe/watermelondb`.
- You don't need to add `rxjs`. NitromelonDB brings it.

## 2. Replace imports

Find and replace `@nozbe/watermelondb` → `nitromelondb` in your **JS/TS source, tests, and Jest mocks**. Every subpath keeps its name:

```js
// before
import { Database, Q } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import { withObservables } from '@nozbe/watermelondb/react'

// after
import { Database, Q } from 'nitromelondb'
import SQLiteAdapter from 'nitromelondb/adapters/sqlite'
import { withObservables } from 'nitromelondb/react'
```

Also move `__mocks__/@nozbe/watermelondb` to `__mocks__/nitromelondb`.

:::danger Don't run that replace on native files
In the Podfile, Xcode project, or Gradle files it produces paths that don't exist. Step 3 **deletes** those lines instead.
:::

## 3. Delete the old native setup

Autolinking does all the native linking now. Delete everything you added by hand for WatermelonDB. Don't point it at the new package.

**iOS**

- Podfile: delete `pod 'WatermelonDB'`, `pod 'simdjson'`, and `pod 'FMDB'`. Don't add `pod 'NitromelonDB'`.
- Xcode project: delete `HEADER_SEARCH_PATHS` entries that point into `@nozbe/watermelondb/.../SupportingFiles`.
- Bridging header, if it imports WatermelonDB: change it to `#import <NitromelonDB/NitromelonDB.h>`.

**Android**

- `android/settings.gradle`: delete the `:watermelondb-jsi` include and its `projectDir` line.
- `android/app/build.gradle`: delete `implementation project(':watermelondb-jsi')`.
- `MainApplication`: delete `WatermelonDBJSIPackage` and `WatermelonDBPackage`.
- R8 / Proguard: change the keep rule to `-keep class com.nitromelondb.** { *; }`.

**Expo**

In `app.json`, replace `@morrowdigital/watermelondb-expo-plugin` with `"nitromelondb"`:

```json
{
  "expo": {
    "plugins": ["nitromelondb"]
  }
}
```

**Windows**

Remove the old UWP `WatermelonDB.vcxproj` / `WMDatabaseBridge` linking, then follow [Installation — Windows](./Installation.mdx#windows).

## 4. Update the adapter

Remove `jsi: false` if you pass it. It throws on iOS and Android now. `jsi: true` is fine but no longer does anything.

```js
const adapter = new SQLiteAdapter({
  schema,
  migrations,
  onSetUpError: error => {},
})
```

## 5. Rebuild

Metro reload is not enough. Do a full native build:

```bash
cd ios && pod install && cd ..
npx react-native run-ios
npx react-native run-android

# Expo:
npx expo prebuild --clean
npx expo run:ios
```

## Recommended: switch to standard decorators

WatermelonDB models use legacy decorators. They keep working in NitromelonDB, so the steps above are all a migration needs. But we recommend switching to standard decorators (TC39 2023-11): they're what JavaScript is standardizing and what TypeScript 5+ uses, they need less Babel setup, and they don't depend on the plugin order that broke on Expo SDK 56 and React Native 0.87. Our example apps use them. Do it right after the migration, or later.

1. **Babel.** Expo: pass `decorators: { version: '2023-11' }` to `babel-preset-expo`. Bare React Native: use `@babel/plugin-proposal-decorators` with `version: '2023-11'` and `@babel/plugin-transform-class-static-block`. The exact configs are in [Installation](./Installation.mdx).
2. **TypeScript.** Remove `experimentalDecorators` and `emitDecoratorMetadata` from `tsconfig.json`. TypeScript 5.0+ is required.
3. **Models.** Add `accessor` to every decorated field: `@text('title') title!: string` becomes `@text('title') accessor title!: string`. Turn `@lazy` fields into getters: `@lazy get recent() { return ... }`.
4. **Restart the bundler with a cleared cache** (`npx expo start --clear` or `npx react-native start --reset-cache`), then run your type checker and tests.

The decorators setting applies to the whole app, including decorators from other libraries. If you use one that only supports legacy decorators (some versions of MobX, TypeORM or class-validator, for example), stay on [legacy decorators](./Advanced/StandardDecorators.md#legacy-decorators) until it supports standard ones.

Models you haven't updated yet keep working after step 1, and in development NitromelonDB logs a warning naming each field that still needs `accessor`. So you can do step 3 one model at a time.

### Let a coding agent do it

Copy this prompt into Claude Code, Cursor or another coding agent, from the root of your app:

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

## Things that may need attention

<details>
  <summary>Build fails with <code>Definitely assigned fields cannot be initialized here</code></summary>

WatermelonDB's setup had you add `@babel/plugin-proposal-decorators` to `babel.config.js`. On Expo SDK 56+ that plugin now runs before `babel-preset-expo`'s own decorator plugins and breaks every field declared with `!`. Remove it: the Expo preset already enables decorators. Bare React Native 0.87+ needs four plugins in a fixed order. Both setups are in [Installation](./Installation.mdx).

</details>

<details>
  <summary>Yarn Classic fails with <code>fatal: not a git repository</code></summary>

`0.30.1-beta.1` and earlier installed `wa-sqlite` from a git URL. Upgrade, or see the [Installation troubleshooting](./Installation.mdx#troubleshooting) for a `resolutions` workaround.

</details>

<details>
  <summary>Flow types and <code>@nozbe/watermelondb/types</code></summary>

The package is written in TypeScript and ships its own `.d.ts` files. Remove `@nozbe/watermelondb` from `.flowconfig`. Don't add `tsconfig` `paths` that point into `node_modules/nitromelondb/src`, because that breaks Metro and Jest.

Type replacements, all from `nitromelondb`:

| Old | New |
| --- | --- |
| `RecordId`, `TableName<T>`, `ColumnName` | same names |
| `RelationId<T>` / `$Call<…>` helpers | `RelationId<Model>` (`string`) or `RelationId<Model \| null>` (`string \| null`) |
| `RawRecord`, `DirtyRaw` | same names. `Associations` comes from `nitromelondb/Model` |
| `$Diff`, `$Rest`, `$Shape` | `Omit`, `Partial`, `Pick` |

`json()` is generic: `json<TInput, TOutput>(column, sanitizer)`. See [Flow support removed](./Advanced/Flow.md).

</details>

<details>
  <summary>Assigning <code>record.id</code></summary>

You can set `record.id` only inside `collection.create()` / `prepareCreate()`. Anywhere else it throws. `_raw.id` and `prepareCreateFromDirtyRaw` still work.

</details>

<details>
  <summary>Adding <code>seed</code> during the migration</summary>

[Database seeding](./Advanced/Seeding.md) records which steps have already run, and WatermelonDB never wrote that record. On a database carried over from WatermelonDB, every seed step **will run**, even if the tables already have user data. Read "Where to be careful in production" on that page first.

</details>

<details>
  <summary>Android Studio Database Inspector no longer shows the database</summary>

NitromelonDB ships its own SQLite build, and the Inspector only sees databases opened through Android's `android.database.sqlite` API. See [Pro Tips — Database viewer](./Advanced/ProTips.md#database-viewer) for how to open it instead.

</details>

## Checklist

- [ ] `@nozbe/watermelondb` removed, `nitromelondb` and `react-native-nitro-modules` (0.35.2+) installed
- [ ] `@nozbe/watermelondb` → `nitromelondb` in JS/TS imports and Jest mocks
- [ ] Old Podfile, Xcode header path, Gradle, and `MainApplication` entries deleted
- [ ] Expo: `"nitromelondb"` plugin instead of `@morrowdigital/watermelondb-expo-plugin`
- [ ] New Architecture on, `jsi: false` removed
- [ ] Babel decorators set up as in [Installation](./Installation.mdx) (Expo: no decorator plugin; bare RN 0.87+: four plugins in order)
- [ ] Full native rebuild
- [ ] Recommended: [switch to standard decorators](#recommended-switch-to-standard-decorators)

Next: [Setup](./Setup.md) covers the `Database` options added since WatermelonDB, such as `seed` and `useDatabaseReady`.
