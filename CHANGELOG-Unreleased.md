### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal

- CI: the Android flashlight benchmark adjusts CPU, FPS and score for the CI machine's speed, like the iOS benchmark does with WatermelonDB: a fixed NotesApp build (v0.32.0, built once and cached) runs in turns with each commit's, and how it compares with its usual values is that job's machine factor. The PR comment compares the adjusted values with the median and range of master's last 10 runs (🟢 better, 🟡 within range, 🔴 clearly worse, ⬆️ / ⬇️ for the direction), and the performance page charts them (once enough runs have the reference)

- NotesApp Windows example: React Native Windows 0.85.0 → 0.85.2 (dependency bumps and a RichEdit load-path hardening; no API changes). Its default Hermes build is unchanged, so the `HermesVersion` pin in `ExperimentalFeatures.props` stays. The Windows e2e suites pass on it.

- Example apps (NotesApp, NotesApp_windows, benchmark) and the iOS test project now use `react-native-nitro-modules` and `nitrogen` 0.37.2. The generated Nitro code only changes in its header comments. On Windows, `NitromelonDB.vcxproj` builds against both Nitro source layouts, so apps on Nitro 0.35–0.36 keep working while apps on 0.37 build too.

- NotesApp Windows example: pinned Hermes is now `0.0.0-2610.28001-08ee40a5` (was `0.0.0-2605.6002-2279da22`), the first published build with the fix for the `HadesGC::OldGen::search` crash that RNW 0.85's default Hermes has ([hermes-windows#392](https://github.com/microsoft/hermes-windows/issues/392), fixed in [#395](https://github.com/microsoft/hermes-windows/pull/395)). The Windows e2e suites pass on it. The pin can go once RNW's own default is that build or newer.
