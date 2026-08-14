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

On React Native (iOS and Android), also add the Nitro peer and rebuild native code:

```bash
yarn add react-native-nitro-modules
```

`react-native-nitro-modules` is optional for web / Node / Electron. It is **required** for SQLite on iOS and Android.

## 2. Rewrite imports

Replace the old scope everywhere — `package.json`, source, tests, Metro/tsconfig path aliases:

| From | To |
| --- | --- |
| `@nozbe/watermelondb` | `nitromelondb` |
| `@nozbe/watermelondb/adapters/sqlite` | `nitromelondb/adapters/sqlite` |
| `@nozbe/watermelondb/adapters/lokijs` | `nitromelondb/adapters/lokijs` |
| `@nozbe/watermelondb/decorators` | `nitromelondb/decorators` |
| `@nozbe/watermelondb/react` | `nitromelondb/react` |
| `@nozbe/watermelondb/sync` | `nitromelondb/sync` |
| `@nozbe/watermelondb/Schema/migrations` | `nitromelondb/Schema/migrations` |

A project-wide replace of `@nozbe/watermelondb` → `nitromelondb` is enough for imports.

Leave **other** `@nozbe/*` packages alone. `@nozbe/simdjson` and `@nozbe/sqlite` are still separate upstream dependencies.

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

Also update `node_modules` paths in native config:

| From | To |
| --- | --- |
| `node_modules/@nozbe/watermelondb` | `node_modules/nitromelondb` |
| `node_modules\@nozbe\watermelondb` (Windows) | `node_modules\nitromelondb` |

## 3. iOS

The CocoaPods spec is now `NitromelonDB` (was `WatermelonDB`).

**Podfile**

```ruby
# before
# pod 'WatermelonDB', path: '../node_modules/@nozbe/watermelondb'
pod 'simdjson', path: '../node_modules/@nozbe/simdjson', modular_headers: true

# after
# pod 'NitromelonDB', path: '../node_modules/nitromelondb'
pod 'simdjson', path: '../node_modules/@nozbe/simdjson', modular_headers: true
```

Autolinking still picks up the pod. Only uncomment the `NitromelonDB` line if you are not using autolinking.

**Bridging header** (if you import the native header yourself):

```objc
// before
#import <WatermelonDB/WatermelonDB.h>

// after
#import <NitromelonDB/WatermelonDB.h>
```

Then:

```bash
cd ios && bundle exec pod install
```

Minimum iOS deployment target is **15.1**.

## 4. Android

Nitro autolinks. Remove the old JSI Gradle module if you had it:

- `include ':watermelondb-jsi'` from `android/settings.gradle`
- `implementation project(':watermelondb-jsi')` from `android/app/build.gradle`
- `WatermelonDBJSIPackage` from `MainApplication`

If you still link the Android library manually, point it at the new package path:

```gradle
include ':watermelondb'
project(':watermelondb').projectDir =
    new File(rootProject.projectDir, '../node_modules/nitromelondb/native/android')
```

Keep the Proguard rule if you use it:

```
-keep class com.nozbe.watermelondb.** { *; }
```

The Java package name `com.nozbe.watermelondb` is unchanged. Turbo-sync JSON injection now goes through `com.nozbe.watermelondb.NitromelonNative.provideSyncJson`.

Minimum Android SDK is **24**.

## 5. SQLiteAdapter on React Native

iOS and Android SQLite is **Nitro-only**. NativeModules interop is gone.

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

## 6. TypeScript (Flow and `.d.ts` are gone)

The library implementation is TypeScript. There is no separate `index.d.ts` tree and no Flow types.

- Delete `@nozbe/watermelondb` from Flow `[libs]` / `.flowconfig` if you had them.
- Point TypeScript path aliases at `nitromelondb`:

```json
{
  "compilerOptions": {
    "paths": {
      "nitromelondb": ["node_modules/nitromelondb/src/index.ts"],
      "nitromelondb/*": ["node_modules/nitromelondb/src/*"]
    }
  }
}
```

App model code can stay JavaScript. If you already used the old `.d.ts` types, they now come from the TypeScript sources.

See [Flow support removed](./Advanced/Flow.md) and the [TypeScript example](https://github.com/StasDoskalenko/NitromelonDB/tree/master/examples/typescript).

## 7. Platform floor

| Requirement | WatermelonDB 0.28 | NitromelonDB |
| --- | --- | --- |
| Node.js | 18+ (typical) | **22+** |
| React Native | 0.74+ in 0.28 | **0.87** (New Architecture) |
| iOS | 12+ | **15.1** |
| Android minSdk | 21 (typical) | **24** |

## Checklist

- [ ] `yarn remove @nozbe/watermelondb && yarn add nitromelondb`
- [ ] `yarn add react-native-nitro-modules` (React Native iOS/Android)
- [ ] Replace `@nozbe/watermelondb` → `nitromelondb` in imports and path aliases
- [ ] Update `node_modules/@nozbe/watermelondb` → `node_modules/nitromelondb` in Podfile / Gradle / Windows project paths
- [ ] Podfile: `WatermelonDB` → `NitromelonDB`; bridging header `#import <NitromelonDB/WatermelonDB.h>`
- [ ] Remove `watermelondb-jsi` / `WatermelonDBJSIPackage` from Android
- [ ] Remove `{ jsi: false }` from `SQLiteAdapter` on iOS/Android
- [ ] `pod install` and a **full native rebuild** (`npx expo run:ios` / `run:android`, or Xcode / Gradle)

Then continue with [Installation](./Installation.mdx) and [Setup](./Setup.md) if anything in native linking is still missing.
