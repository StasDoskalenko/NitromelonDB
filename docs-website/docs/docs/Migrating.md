---
title: Migrating from WatermelonDB
hide_title: true
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

## Things that may need attention

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
- [ ] Full native rebuild

Next: [Setup](./Setup.md) covers the `Database` options added since WatermelonDB, such as `seed` and `useDatabaseReady`.
