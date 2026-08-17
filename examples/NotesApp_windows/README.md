# NotesApp for Windows (New Architecture)

React Native Windows **0.84** NotesApp using the New Architecture (`cpp-app` / Fabric / WinAppSDK). This is the playground for NitromelonDB SQLite on RNW.

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

## Native SQLite

This app autolinks `native/windows`, a WinAppSDK module that:

1. Implements the `NitroModules` TurboModule (`install()`) that `react-native-nitro-modules` JS expects
2. Registers the `Nitromelon` HybridObject and runs SQLite through the same C++ engine as iOS/Android

`react-native-nitro-modules` still has no official Windows autolink ([nitro#168](https://github.com/mrousavy/nitro/issues/168)), so `react-native.config.js` spreads `windowsAppDependencies()` from `windows-autolink.js`. That skips Nitro's missing Windows project; NitromelonDB's DLL is the install entry point.

## Regenerating the Windows project

```sh
npx react-native init-windows --template cpp-app --name NitromelonWindows --namespace NitromelonWindows --overwrite
```

Re-apply Metro / `react-native.config.js` customizations afterward — `init-windows` overwrites `metro.config.js`.
