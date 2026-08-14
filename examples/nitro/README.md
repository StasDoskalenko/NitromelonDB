# NitromelonDB Nitro example

Expo SDK 57 development-build app that opens SQLite through `SQLiteAdapter` → a typed `NitromelonDatabase` HybridObject. This will not run in Expo Go.

The screen is a small notes list: schema v2, a v1→v2 migration that adds `pinned`, and create / pin / delete against the live database.

```sh
cd examples/nitro
npm install
npx expo prebuild
npx expo run:ios
# or
npx expo run:android
```

If you already have a native build and only JS changed, reload Metro. After pulling native SQLite/Nitro changes, rebuild (`npx expo run:ios` / `run:android`).

The app links the library via `file:../..`. Metro watches `src/` plus WatermelonDB's JS dependencies (`rxjs`, `sql-escape-string`, …) so those imports resolve outside the example's tree.

`expo prebuild` applies `plugins/withSimdjsonModularHeaders.js` so CocoaPods can import `simdjson` from the Nitrogen-generated `NitromelonDB` module.

`patches/expo-modules-jsi+57.0.4.patch` works around [expo#48522](https://github.com/expo/expo/issues/48522): on Xcode 26.3, C++ `abs` collides with Swift `abs` while compiling `ExpoModulesJSI`. Drop the patch once an `expo-modules-jsi` release includes `Swift.abs`.
