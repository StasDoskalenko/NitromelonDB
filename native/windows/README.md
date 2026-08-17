# NitromelonDB for React Native Windows

WinAppSDK / Composition native module. This is the Windows SQLite implementation.

It autolinks through the package `react-native.config.js` (`native/windows`). Apps should also spread `windowsAppDependencies()` from `windows-autolink.js` so `react-native-nitro-modules` is not searched for a Windows project it does not ship ([nitro#168](https://github.com/mrousavy/nitro/issues/168)).

The DLL:

1. Implements the `NitroModules` TurboModule (`install()`)
2. Registers the `Nitromelon` HybridObject
3. Compiles Nitro C++ from `react-native-nitro-modules` plus `native/nitro`, `native/shared`, and vendored SQLite / simdjson

`include/NitroModules/` is gitignored. Yarn postinstall (and the vcxproj, before compile) generate one-line shims so `#include <NitroModules/Foo.hpp>` resolves on MSVC. `--ignore-scripts` still works: MSBuild runs the same generator.
