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

- CI: Windows job uses `windows-2025` (preinstalled VS 2022, SDK 26100, Node 24.19, WinAppDriver). It builds NotesApp and runs the Cavy SQLite integration suite via `@react-native-windows/automation`.
- Windows Nitro `<NitroModules/…>` header map is generated on install / MSBuild (`scripts/windows-nitro-shims.mjs`), not checked in.
