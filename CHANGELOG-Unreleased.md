### Highlights

### New features

- **Windows:** React Native Windows New Architecture (RNW 0.84 / WinAppSDK) uses Nitro SQLite. Autolinking points at `native/windows`. Apps spread `windowsAppDependencies()` from `nitromelondb/windows-autolink` so `react-native-nitro-modules` is not searched for a Windows project it does not ship.

### BREAKING CHANGES

- **Windows:** the UWP Paper `WMDatabaseBridge` JSI installer is removed. `{ jsi: false }` is rejected on Windows the same as iOS/Android.

### Deprecations

### Fixes

### Performance

### Changes

- Docs: README and the docs site use the horizontal NitromelonDB logo via a GitHub absolute URL.
- Docs no longer tell apps to install `rxjs` by hand. It stays a peer (`^7.8.0`) for hoisting and a dependency so `yarn add nitromelondb` installs it.
- Migration / install docs: remove leftover `pod 'simdjson'` and clarify that the `com.nozbe.watermelondb` Proguard keep rule stays.

### Internal

- CI: replace the disabled UWP WatermelonTester job with an ARM64 Release build of `examples/NotesApp_windows` on `windows-11-vs2026-arm` (VS 2026 / v145).
