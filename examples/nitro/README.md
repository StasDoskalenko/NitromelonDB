# NitromelonDB Nitro example

Expo SDK 57 development-build app that calls the `Nitromelon` HybridObject (`ping()` / `nativeEngine`). This will not run in Expo Go.

```sh
cd examples/nitro
npm install
npx expo prebuild
npx expo run:ios
# or
npx expo run:android
```

The app links the library via `file:../..` and Metro watches `src/` so edits to `src/nitro` reload. Native SQLite (`SQLiteAdapter`) now goes through the `NitromelonDatabase` HybridObject; this screen still calls `ping()` as a smoke test.

`expo prebuild` applies `plugins/withSimdjsonModularHeaders.js` so CocoaPods can import `simdjson` from the Nitrogen-generated `NitromelonDB` module.

`patches/expo-modules-jsi+57.0.4.patch` works around [expo#48522](https://github.com/expo/expo/issues/48522): on Xcode 26.3, C++ `abs` collides with Swift `abs` while compiling `ExpoModulesJSI`. Drop the patch once an `expo-modules-jsi` release includes `Swift.abs`.
