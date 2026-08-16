---
title: Migrating from WatermelonDB
hide_title: true
---

# Migrating from WatermelonDB

NitromelonDB is a maintained fork of [WatermelonDB](https://github.com/Nozbe/WatermelonDB) (`@nozbe/watermelondb`). Models, schema, queries, writers, sync, LokiJS, and the web adapters are the same API. What changed is the **npm package name**, **native linking**, and a few **React Native SQLite** requirements.

If you are starting a new app, skip this page and go to [Installation](./Installation.mdx).

:::info What you keep
Your existing SQLite files, schema version, migrations, and model classes keep working. This is a library swap, not a data migration.
:::

## 1. Swap the npm package

```bash
yarn remove @nozbe/watermelondb
yarn add nitromelondb

# (or with npm:)
npm uninstall @nozbe/watermelondb
npm install nitromelondb
```

`rxjs` `^7.8.0` is both a **dependency** and a **peer**. The dependency is what `yarn add nitromelondb` / `npm install nitromelondb` installs for you. The peer is so Yarn/npm hoist a single copy if the app already has RxJS (two copies break `Observable` / `Subscription` types). You do not add it yourself.

On React Native (iOS and Android), also add the Nitro peer and rebuild native code — **skip this if `react-native-nitro-modules` is already in the app** (do not double-install it):

```bash
yarn add react-native-nitro-modules
```

Use `react-native-nitro-modules` **0.35.2 or newer**. NitromelonDB is built against 0.36.x; a `*` peer range used to hide ABI mismatches that only show up in Xcode or Gradle.

`react-native-nitro-modules` is optional for web / Node / Electron. It is **required** for SQLite on iOS and Android.

After the JS swap you still need **`pod install` and a full native rebuild**. Metro reload is not enough.

## 2. Rewrite imports

Replace the old scope in **JavaScript/TypeScript source, tests, and Jest mocks** — not in leftover native project files (see [iOS](#3-ios) and [Android](#4-android)):

| From | To |
| --- | --- |
| `@nozbe/watermelondb` | `nitromelondb` |
| `@nozbe/watermelondb/adapters/sqlite` | `nitromelondb/adapters/sqlite` |
| `@nozbe/watermelondb/adapters/lokijs` | `nitromelondb/adapters/lokijs` |
| `@nozbe/watermelondb/decorators` | `nitromelondb/decorators` |
| `@nozbe/watermelondb/react` | `nitromelondb/react` |
| `@nozbe/watermelondb/sync` | `nitromelondb/sync` |
| `@nozbe/watermelondb/Schema/migrations` | `nitromelondb/Schema/migrations` |
| `@nozbe/watermelondb/utils/common/randomId` | `nitromelondb/utils/common/randomId` |
| `@nozbe/watermelondb/utils/common/logger` | `nitromelondb/utils/common/logger` |

A project-wide replace of `@nozbe/watermelondb` → `nitromelondb` is enough for **JS/TS imports**. It is **not** enough for native files.

Leave **other** `@nozbe/*` packages alone. `simdjson` and SQLite are vendored inside NitromelonDB (`native/vendor/`).

```js
// before
import { Database, Q } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import { field, writer } from '@nozbe/watermelondb/decorators'
import { withObservables } from '@nozbe/watermelondb/react'
import { synchronize } from '@nozbe/watermelondb/sync'

// after
import { Database, Q } from 'nitromelondb'
import SQLiteAdapter from 'nitromelondb/adapters/sqlite'
import { field, writer } from 'nitromelondb/decorators'
import { withObservables } from 'nitromelondb/react'
import { synchronize } from 'nitromelondb/sync'
```

## 3. iOS

Autolinking picks up the `NitromelonDB` pod. **Remove** any WatermelonDB / simdjson / FMDB lines you added by hand — simdjson is compiled into NitromelonDB from vendored sources. You do not add a `pod 'simdjson'`, `pod 'FMDB'`, or `pod 'NitromelonDB'` line. FMDB is not used.

```ruby
# Remove these lines if they are in your Podfile.
# Autolinking provides NitromelonDB. simdjson is compiled into that pod —
# there is no separate simdjson (or FMDB) pod to add.
#
# pod 'WatermelonDB', path: '../node_modules/@nozbe/watermelondb'
# pod 'NitromelonDB', path: '../node_modules/nitromelondb'
# pod 'simdjson', path: '../node_modules/@nozbe/simdjson', modular_headers: true
```

Then `pod install` (Expo: `npx expo prebuild`).

`use_frameworks! :linkage => :static` (common in RN Firebase apps) is supported. Prefer static linkage if you must use frameworks. See [Installation — Bare React Native](./Installation.mdx#bare-react-native).

**Bridging header** (only if you import the native header yourself):

```objc
// before
#import <WatermelonDB/WatermelonDB.h>

// after
#import <NitromelonDB/WatermelonDB.h>
```

:::warning Do not retarget old header search paths
A project-wide path replace will turn `node_modules/@nozbe/watermelondb/native/ios/.../SupportingFiles` into `node_modules/nitromelondb/native/ios/.../SupportingFiles`, which is not a public include path. **Delete** those `HEADER_SEARCH_PATHS` / `SupportingFiles` entries from the pbxproj. Autolinking and the podspec set the headers.
:::

Minimum iOS deployment target is **15.1**.

## 4. Android

Nitro autolinks. **Delete** the old JSI Gradle module — do not retarget it:

- `include ':watermelondb-jsi'` from `android/settings.gradle`
- `implementation project(':watermelondb-jsi')` from `android/app/build.gradle`
- `WatermelonDBJSIPackage` from `MainApplication`

:::danger There is no `native/android-jsi`
A string replace of `@nozbe/watermelondb` → `nitromelondb` will produce:

```gradle
project(':watermelondb-jsi').projectDir =
    new File(rootProject.projectDir, '../node_modules/nitromelondb/native/android-jsi')
```

That path **does not exist**. Remove the whole JSI block. Do not point it at `native/android` either — that module autolinks.
:::

Do not register `WatermelonDBPackage` by hand — that is the old architecture. Autolinking is required.

The Android Java package is still `com.nozbe.watermelondb`. If you already have this R8 / Proguard rule, **leave it** — do not delete it:

```
-keep class com.nozbe.watermelondb.** { *; }
```

Turbo-sync JSON injection now goes through `com.nozbe.watermelondb.NitromelonNative.provideSyncJson`.

Minimum Android SDK is **24**.

## 5. Expo

The config plugin is **optional for bare React Native**. Autolinking is what actually links SQLite. On Expo, add the plugin so prebuild keeps the New Architecture on (it **rejects** `"newArchEnabled": false`).

You do **not** need `@morrowdigital/watermelondb-expo-plugin` (that package wired the old Android JSI module).

```bash
yarn remove @morrowdigital/watermelondb-expo-plugin
```

In `app.json` / `app.config.js`, replace it with `"nitromelondb"`:

```json
{
  "expo": {
    "plugins": ["nitromelondb"]
  }
}
```

Then `npx expo prebuild` (or let EAS Build do it). Development builds, EAS Build, and EAS Update are supported. Expo Go is not. See [Installation — Expo](./Installation.mdx#expo).

## 6. SQLiteAdapter on React Native

iOS and Android SQLite is **Nitro-only**. NativeModules interop is gone. The **old React Native architecture** (Paper / the legacy bridge) is **not supported** — enable the New Architecture (on by default in React Native 0.87; required on 0.83+ as well).

```js
const adapter = new SQLiteAdapter({
  schema,
  migrations,
  // `{ jsi: false }` throws on iOS/Android. Omit it, or leave `jsi: true`.
  onSetUpError: error => {},
})
```

- **Do not** pass `{ jsi: false }` on iOS/Android.
- Web still uses LokiJS (or Node SQLite in Electron/Node).
- Windows still uses the JSI installer (`{ jsi: true }`).

If SQLiteAdapter cannot create a native database, install `react-native-nitro-modules` and rebuild the app — Metro reload is not enough.

## 7. TypeScript (Flow and hand-written `.d.ts` are gone)

The library implementation is TypeScript. The **published** package ships `index.d.ts` next to compiled JS. Do **not** add `tsconfig` path aliases to `node_modules/nitromelondb/src/*.ts` or to a `.d.ts` file in isolation — those files are not what npm installs, and mapping the package onto them breaks Metro and Jest.

- Delete `@nozbe/watermelondb` from Flow `[libs]` / `.flowconfig` if you had them.
- Let TypeScript resolve `nitromelondb` from the package (no `paths` workaround).

App model code can stay JavaScript.

### Flow / `@nozbe/watermelondb/types` → TypeScript

`@nozbe/watermelondb/types` is gone. Import replacements from `nitromelondb`:

| Flow / old import | TypeScript |
| --- | --- |
| `RecordId` | `import type { RecordId } from 'nitromelondb'` |
| `TableName<T>` / `ColumnName` | `import type { TableName, ColumnName } from 'nitromelondb'` |
| `RelationId<T>` or `$Call<…>` extractors (e.g. a `NonNullableRelation` helper) | `import type { RelationId } from 'nitromelondb'` — `RelationId<Model>` is `string`; `RelationId<Model \| null>` is `string \| null` |
| `Associations`, `RawRecord`, `DirtyRaw` | `import type { Associations } from 'nitromelondb/Model'` and `import type { RawRecord, DirtyRaw } from 'nitromelondb'` |
| `$Diff`, `$Rest`, `$Shape` | TypeScript `Omit`, `Partial`, `Pick` |

See [Flow support removed](./Advanced/Flow.md) and the [TypeScript example](https://github.com/StasDoskalenko/NitromelonDB/tree/master/examples/typescript).

### `@json` sanitizers

`json()` is generic: `json<TInput, TOutput>(column, (source: TInput) => TOutput)`. Typed sanitizers from WatermelonDB apps type-check, including ones that change the type (`(source: string) => string[]`). `memo` on the options object is optional (default `false`).

### Custom `Model.id`

`Model.id` is assignable **only** inside `collection.create()` / `prepareCreate()`:

```js
await collection.create(record => {
  record.id = serverId
})
```

Assigning `record.id` anywhere else throws. `_raw.id` and `prepareCreateFromDirtyRaw` still work.

## 8. Jest / Metro

- Move `__mocks__/@nozbe/watermelondb` to `__mocks__/nitromelondb` (and the same for any subpath mocks).
- Do **not** path-map `nitromelondb` to unpublished `.ts` sources or to a `.d.ts` file. The published package is compiled JS at the package root.
- That compiled JS does **not** need `transformIgnorePatterns` for `nitromelondb`.
- If a release bundle loads `nitro.json` and SQLite never opens, you are on `0.30.0-beta.1`. Upgrade; do not patch `require('.../nitro')` yourself after that.

## 9. Platform floor

| Requirement | WatermelonDB 0.28 | NitromelonDB |
| --- | --- | --- |
| Node.js | 18+ (typical) | App Node version follows your React Native release. This repo's example/CI uses **22+**. |
| React Native | 0.74+ in 0.28 | **New Architecture required.** Tested on **0.83+**. [`examples/NotesApp`](https://github.com/StasDoskalenko/NitromelonDB/tree/master/examples/NotesApp) uses Expo SDK 57 (RN 0.86). [`examples/NotesApp_windows`](https://github.com/StasDoskalenko/NitromelonDB/tree/master/examples/NotesApp_windows) uses RN 0.84.1 to match RNW 0.84. Old / Paper architecture is not supported. |
| iOS | 12+ | **15.1** |
| Android minSdk | 21 (typical) | **24** |
| `react-native-nitro-modules` | n/a | **≥ 0.35.2** (optional peer on web) |
| `rxjs` | transitive | **dependency + peer `^7.8.0`** (installed with the package) |

## Checklist

- [ ] `yarn remove @nozbe/watermelondb && yarn add nitromelondb`
- [ ] `yarn add react-native-nitro-modules` if it is not already a dependency (`>=0.35.2`)
- [ ] Replace `@nozbe/watermelondb` → `nitromelondb` in **JS/TS imports**, Jest mocks, and path aliases — not in native JSI / SupportingFiles paths
- [ ] Remove hand-copied `pod 'WatermelonDB'` / `pod 'NitromelonDB'` / `pod 'simdjson'` / `pod 'FMDB'` lines from the Podfile
- [ ] Delete pbxproj `SupportingFiles` / old Watermelon header search paths; do not retarget them
- [ ] Bridging header, if you import it: `#import <NitromelonDB/WatermelonDB.h>`
- [ ] **Delete** `watermelondb-jsi` / `WatermelonDBJSIPackage` from Android. Do not retarget `native/android-jsi`
- [ ] Enable the New Architecture (old / Paper architecture is not supported)
- [ ] Remove `{ jsi: false }` from `SQLiteAdapter` on iOS/Android
- [ ] Expo: add `"nitromelondb"` to `app.json` `plugins` and remove `@morrowdigital/watermelondb-expo-plugin`. Bare apps can skip the plugin.
- [ ] `pod install` and a full native rebuild (`npx react-native run-ios` / `run-android`, or `npx expo run:ios` / `run:android`) — not a Metro reload

Then continue with [Installation](./Installation.mdx) and [Setup](./Setup.md) if anything in native linking is still missing.
