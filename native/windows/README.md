# NitromelonDB for React Native Windows

WinAppSDK / Composition native module. This is the Windows SQLite implementation for RNW **New Architecture** (0.84+).

## Tools to build

| Tool | Version / notes |
| --- | --- |
| Windows | Windows 10 22H2+ or Windows 11 |
| Node.js | **22.11+** (RNW 0.84 refuses older engines) |
| Yarn | Classic (v1), same as the rest of this repo |
| Visual Studio | **2022** (MSVC **v143**) or **2026** (MSVC **v145**). The vcxproj uses `$(DefaultPlatformToolset)` so either works. |
| Workloads | Desktop development with C++; Windows application development (Windows App SDK / WinUI) |
| Windows SDK | **10.0.26100** (the NotesApp example pins this) |
| NuGet | Used to restore `Microsoft.ReactNative` and Windows App SDK |

Run [RNW's dependency script](https://microsoft.github.io/react-native-windows/docs/rnw-dependencies) from an elevated PowerShell prompt if anything is missing:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\node_modules\react-native-windows\scripts\rnw-dependencies.ps1
```

Playground: [`examples/NotesApp_windows`](../../examples/NotesApp_windows). CI uses GitHub `windows-2025` (VS 2026, SDK 26100, WinAppDriver), splits compile from e2e, and runs Maestro-equivalent NotesApp UI flows.

## How Nitro is injected on Windows

`react-native-nitro-modules` has **no official Windows autolink** yet ([nitro#168](https://github.com/mrousavy/nitro/issues/168)). NitromelonDB does not wait for that package to grow a `windows/` project. The NitromelonDB DLL **is** the Nitro install entry point.

```
JS  react-native-nitro-modules
      TurboModuleRegistry.getEnforcing('NitroModules').install()
        │
        ▼
WinRT TurboModule in NitromelonDB.dll  (REACT_MODULE NitroModules)
      install()
        │  CallInvokerDispatcher(reactContext.CallInvoker())
        ▼
margelo::nitro::install(*jsiRuntime, dispatcher)
        │
        ▼
HybridObjectRegistry["Nitromelon"] → HybridNitromelon
        │
        ▼
SQLite via native/nitro + native/shared + vendored sqlite/simdjson
```

Pieces:

1. **Library autolink** — package `react-native.config.js` points RNW at `native/windows` (`NitromelonDB.vcxproj`).
2. **Skip Nitro's missing Windows project** — apps spread `windowsAppDependencies()` from `windows-autolink.js`, which sets `react-native-nitro-modules` `platforms.windows` to `null`.
3. **Same JS as iOS/Android** — `SQLiteAdapter` uses the `Nitromelon` HybridObject (`makeDispatcher/index.native.ts`). `{ jsi: false }` is rejected on Windows too.
4. **Compile Nitro C++ from node_modules** — the vcxproj compiles `react-native-nitro-modules/cpp` plus `native/nitro`, `native/shared`, and vendored SQLite / simdjson.
5. **MSVC header map** — Nitrogen emits `#include <NitroModules/Foo.hpp>`. iOS/Android header maps provide that prefix; MSVC does not. `include/NitroModules/` is gitignored. Yarn postinstall in this repo (and the vcxproj, before compile) run `scripts/windows-nitro-shims.mjs` to emit one-line shims. Skipping install scripts is still safe because MSBuild runs the same generator.

## App install

```bash
yarn add nitromelondb react-native-nitro-modules
```

In the app `react-native.config.js`:

```js
const { windowsAppDependencies } = require('nitromelondb/windows-autolink')

module.exports = {
  dependencies: windowsAppDependencies(),
}
```

If you link NitromelonDB with `file:` (a monorepo), pass `{ root: path.resolve(__dirname, '../path-to-nitromelondb') }`.

Then:

```bash
yarn react-native run-windows
```

See [Installation — Windows](https://github.com/StasDoskalenko/NitromelonDB/blob/master/docs-website/docs/docs/Installation.mdx) for Babel and manual linking.
