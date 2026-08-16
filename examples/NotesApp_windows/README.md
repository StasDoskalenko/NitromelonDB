# NotesApp for Windows (New Architecture)

React Native Windows **0.84** NotesApp using the New Architecture (`cpp-app` / Fabric / WinAppSDK). This is the playground for bringing NitromelonDB SQLite to RNW New Architecture.

iOS and Android live in the sibling Expo app, [`../NotesApp`](../NotesApp). They cannot share one `package.json` yet: RNW 0.84 tracks React Native **0.84.1**, while the Expo app is on **0.86.2**.

The screen is the same notes list: schema v2, a v1→v2 `pinned` migration, plus create / pin / delete.

## Requirements

- Node.js **22.11+** (RNW 0.84 refuses older engines)
- [React Native Windows dependencies](https://microsoft.github.io/react-native-windows/docs/rnw-dependencies), including **Visual Studio 2026**
- Windows 10/11 with the Windows App SDK workload

## Run

```sh
cd examples/NotesApp_windows
npm install --ignore-scripts
npm run windows
```

`--ignore-scripts` skips the library `postinstall` (`patch-package`). That script belongs to the repo root, not this example.

`run-windows` builds the WinAppSDK app and starts Metro. After JS-only changes, reload Metro. After native SQLite/Nitro changes, rebuild.

The app links the library via `file:../..`. Metro watches `src/` plus WatermelonDB JS dependencies (`rxjs`, `sql-escape-string`, …) so those imports resolve outside the example tree.

## Native SQLite status

`native/windows` is the **old** UWP Paper module (`Microsoft.ReactNative.Uwp.CppLib`). It cannot autolink into this WinAppSDK New Architecture app, so `react-native.config.js` currently disables Windows autolinking for `nitromelondb` and `react-native-nitro-modules`.

Until the New Architecture Windows SQLite module lands, the UI still loads and shows the setup error from `SQLiteAdapter`. Use this app to iterate on that native port.

## Regenerating the Windows project

```sh
npx react-native init-windows --template cpp-app --name NitromelonWindows --namespace NitromelonWindows --overwrite
```

Re-apply Metro / `react-native.config.js` customizations afterward — `init-windows` overwrites `metro.config.js`.
