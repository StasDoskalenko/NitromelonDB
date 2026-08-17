# Database Adapters

In this guide, you'll learn how to add support for new databases and new platforms to WatermelonDB.

## Introduction

WatermelonDB is designed to be database-agnostic. It's a frontend JavaScript database framework, but its high-level abstractions can be plugged in to any underlying database, platform, or UI framework. We call the translation layer between underlying databases and high-level WatermelonDB APIs **database adapters**.

## Currently supported databases

### SQLite

Supported frameworks:

- React Native:
  - Operating systems:
    - iOS
    - Android
    - Windows (RNW New Architecture / WinAppSDK)
  - Implementations:
    - Nitro HybridObject (iOS, Android, and Windows)
- NodeJS
  - via `better-sqlite3` - contributed by Sid Ferreira

### LokiJS

Supported frameworks:

- Web
  - Storage: IndexedDB
- NodeJS
  - Storage: in-memory only

Why [LokiJS](http://techfort.github.io/LokiJS/)? WebSQL would be a perfect fit for Watermelon, but sadly is a dead API, so we must use IndexedDB, but its querying capabilities make it unsuitable as a serious database. LokiJS implements a very fast in-memory querying API, using IndexedDB as storage.

## Contribute these adapters!

Please contribute to WatermelonDB. We'd love to support these platforms and databases:

- [React Native for macOS](https://microsoft.github.io/react-native-macos/)
- [Realm database](https://github.com/realm/realm-cpp)
- SQLite for web ([sql.js](https://github.com/sql-js/sql.js/) or [absurd-sql](https://github.com/jlongster/absurd-sql))
- LokiJS NodeJS storage option
- SQLite for [Electron](https://www.electronjs.org), Tauri, etc.
- SQLite for [Capacitor](https://capacitorjs.com)

## Adding new React Native operating systems

Thanks to our cross-platform C++ SQLite adapter, it takes very little code to add support for new React Native platforms (like macOS).

All you have to do is this:

- Compile `.cpp` files in `native/shared` folder
- Link library with `sqlite3`
  - Use system-provided sqlite3 if possible (we do that on iOS)
  - If not, we ship sqlite source in `native/vendor/sqlite`. Add that directory to search paths and compile `sqlite3.c`
- Provide implementation for `native/shared/DatabasePlatform.h`
  - Please note that most of these functions can remain unimplemented (empty) for basic operation - e.g. you can skip logging, memory, turbo json support
- Provide a React Native hook that calls `Database::install(jsi::Runtime *)`

Check out `native/android` and `native/ios` for two implementation examples. You might be able to reuse some code from these, e.g. platform support stubs or `CMakeLists.txt`.

## Adding new frameworks to SQLite adapter

Let's say you want to add support for a new JS+native framework, like Electron, Tauri, NativeScript or Capacitor.

This takes more work, but ultimately, given that (iOS, Android, JS, C++) are supported already (just for React Native and Node), you only need to develop the glue code necessary to bridge the gap between `src/adapters/sqlite` JS code, and the native but non-React-Native-specific bits. You'll need some familiarity with the platform you're trying to support, but little WatermelonDB/React Native/C++ familiary will be needed to get this done.

### JS-side glue

The general SQLite implementation is in `src/adapters/sqlite/index.ts`. It forwards database calls to `this._dispatcher`. The dispatcher is the JS-side bridge/glue code.

See `src/adapters/sqlite/makeDispatcher` to see concrete dispatchers and add your own, depending on the platform's convention of calling native code. For example:

- `makeDispatcher/index.ts` (Node JS) just imports more JS code, since native=JS in this case
- `makeDispatcher/index.native.ts` (React Native) uses the `Nitromelon` HybridObject on iOS, Android, and Windows.

### Native-side glue

Depending on the capabilities of the framework you want to support, there's a few ways to go about this:

**The easy (JS-only) way**. If your framework has existing SQLite bindings in JavaScript **that work synchronously** (similar to [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) in Node), you can reuse code in `src/adapters/sqlite/sqlite-node`

**The C++ way**. Reuse `native/shared` and wrap it the way your framework talks to native code. On React Native that wrapper is the `Nitromelon` / `NitromelonDatabase` Nitro HybridObject (`native/nitro`, spec in `src/nitro/Nitromelon.nitro.ts`), including Windows (`native/windows`).

## Adding new databases

If you want to contribute support to new underlying databases (i.e. not SQL or LokiJS-based), this is a rough sketch of what's required:

- A new `FoodbAdapter` that conforms to `DatabaseAdapter` (`src/adapters/type.js`). You can initially skip some method implementations for basic support, most basic are `find, query, count, batch`.
- Some way to convert WatermelonDB's query language into queries specific for your database. For reference, see:
  - `src/adapters/sqlite/encodeQuery` for generating SQL
  - `src/adapters/lokijs/worker/encodeQuery` for generating LokiJS queries + `executeQuery` which executes joins (which Loki does not natively support)
