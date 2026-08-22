# NotesApp for Windows (New Architecture)

React Native Windows **0.84** NotesApp using the New Architecture (`cpp-app` / Fabric / WinAppSDK). This is the playground for NitromelonDB SQLite on RNW.

iOS and Android live in the sibling Expo app, [`../NotesApp`](../NotesApp). They cannot share one `package.json` yet: RNW 0.84 tracks React Native **0.84.1**, while the Expo app is on **0.86.2**.

The Windows host (`src/App.tsx`) renders the **same UI** from [`../NotesApp/src`](../NotesApp/src) (screen, components, model, hooks). Metro watches that folder. List virtualization is `NotesList.windows.tsx` (`FlatList`); iOS/Android use FlashList. Edit files under `examples/NotesApp/src`, not a copy in this app.

![NitromelonDB notes screen on Windows, showing two notes, Nitro SQLite, and schema v2](assets/screenshot.png)

## Tools

| Tool | Version / notes |
| --- | --- |
| Windows | Windows 10 22H2+ or Windows 11 |
| Node.js | **22.11+** (RNW 0.84 refuses older engines) |
| Yarn | 4.18 (pinned) — do not use npm / `package-lock.json` in this example |
| Visual Studio | **2022** (MSVC **v143**) or **2026** (MSVC **v145**) |
| Workloads | Desktop development with C++; Windows application development (Windows App SDK / WinUI) |
| Windows SDK | **10.0.26100** (pinned in `windows/ExperimentalFeatures.props`) |

If Visual Studio or the SDK is missing, run [RNW's dependency script](https://microsoft.github.io/react-native-windows/docs/rnw-dependencies) from an elevated PowerShell prompt:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\node_modules\react-native-windows\scripts\rnw-dependencies.ps1
```

How Nitro is injected (TurboModule `install()` inside the NitromelonDB DLL, header shims, autolink skip): [`native/windows/README.md`](../../native/windows/README.md).

## Run

```sh
cd examples/NotesApp_windows
yarn
```

Library `postinstall` only generates the Nitro `<NitroModules/…>` header map (`scripts/windows-nitro-shims.mjs`). MSBuild runs the same generator before compile, so a skipped install script is still safe.

| Script | What it does |
| --- | --- |
| `yarn metro` / `yarn start` | Start Metro (JS bundler) |
| `yarn metro:kill` | Kill whatever is bound to port 8081 (and matching Metro node processes) |
| `yarn build:debug` | Rebuild x64 Debug, do not launch |
| `yarn build:release` | Rebuild x64 Release, do not launch |
| `yarn build:all` | Rebuild Debug then Release |
| `yarn start:debug` | Deploy + launch the last Debug build (no rebuild, no Metro) |
| `yarn start:release` | Deploy + launch the last Release build (no rebuild, no Metro) |
| `yarn windows` | Build Debug, start Metro, and launch (full first-run) |

Debug loads JS from Metro — run `yarn metro` in one terminal, then `yarn start:debug` in another. After JS-only changes, restart the app process (Ctrl+R is not bound on this Win32 host). After native SQLite/Nitro changes, `yarn build:debug` (or `yarn build:release`) then launch. Debug and Release share one AppX identity, so deploying one replaces the other.

```sh
yarn test:windows:e2e
```

That drives the same flows as `examples/NotesApp/maestro/` (cold start, add-pin-delete, kill-and-relaunch, interaction burst, pagination-seed, pagination-dynamic) through WinAppDriver.

CI builds the app and runs WinAppDriver UI e2e that matches the NotesApp Maestro flows (cold start, CRUD, kill-and-relaunch, interaction burst, sticky pagination). Library SQLite Cavy still runs in `native/iosTest` / `native/androidTest`. Maestro itself does not drive this WinAppSDK app.

The app links the library via `link:../..` (a symlink, not a copy — Yarn's `file:` protocol would copy the whole repo, including gigabytes of MSBuild output). Metro watches `src/` plus WatermelonDB JS / integration-test dependencies (`rxjs`, `sql-escape-string`, `rambdax`, `big-list-of-naughty-strings`, …) so those imports resolve outside the example tree.

## Native SQLite

This app autolinks `native/windows`, a WinAppSDK module that:

1. Implements the `NitroModules` TurboModule (`install()`) that `react-native-nitro-modules` JS expects
2. Registers the `Nitromelon` HybridObject and runs SQLite through the same C++ engine as iOS/Android

`react-native-nitro-modules` still has no official Windows autolink ([nitro#168](https://github.com/mrousavy/nitro/issues/168)), so `react-native.config.js` spreads `windowsAppDependencies()` from `windows-autolink.js`. That skips Nitro's missing Windows project; NitromelonDB's DLL is the install entry point.

## Regenerating the Windows project

```sh
yarn react-native init-windows --template cpp-app --name NitromelonWindows --namespace NitromelonWindows --overwrite
```

Re-apply Metro / `react-native.config.js` customizations afterward — `init-windows` overwrites `metro.config.js`.
