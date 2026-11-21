# native/windows — React Native Windows (WinAppSDK) native module

Full design, with a diagram: `README.md` here. What is easy to get wrong:

- `react-native-nitro-modules` has no Windows autolink ([nitro#168](https://github.com/mrousavy/nitro/issues/168)). This DLL implements the `NitroModules` TurboModule `install()` itself. Apps skip Nitro's missing Windows project with `windowsAppDependencies()` from `windows-autolink.js`.
- The vcxproj compiles `react-native-nitro-modules/cpp`, `native/nitro`, `native/shared`, and the vendored SQLite/simdjson. A change to shared C++ ships on Windows too.
- MSVC has no header map for `#include <NitroModules/Foo.hpp>`. `scripts/windows-nitro-shims.mjs` generates one-line shims into the gitignored `include/NitroModules/`, from both postinstall and MSBuild before compile. Do not hand-write or commit them.
- The vcxproj uses `$(DefaultPlatformToolset)` so VS 2022 (v143) and VS 2026 (v145) both work. Do not pin a toolset. Windows SDK is 10.0.26100.
- This only builds on Windows. From macOS, rely on the CI `windows` job and say that you could not build it locally.
