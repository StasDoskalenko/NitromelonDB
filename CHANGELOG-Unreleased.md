### Highlights

### BREAKING CHANGES

- Minimum supported Node.js version is now 22.x (required by React Native 0.87)
- [iOS] Minimum deployment target is now iOS 15.1
- [Android] Minimum SDK version is now 24
- [iOS] CocoaPods spec renamed from `WatermelonDB` to `NitromelonDB`. Update Podfiles (`pod 'NitromelonDB'`) and bridging-header imports (`#import <NitromelonDB/WatermelonDB.h>`).
- [SQLite][RN] iOS/Android SQLite is Nitro-only. NativeModules interop (`{ jsi: false }`) is removed. Windows still uses the JSI installer. Web and Electron keep the Node/better-sqlite3 dispatcher (`makeDispatcher/index.ts` / `index.web.ts`).
- [Nitro] The `NitromelonDatabase` HybridObject now exposes the full SQLite adapter API (`initialize`, `find`, `query`, `batchJSON`, …) as typed Nitrogen methods. The `ping()` / `nativeEngine` smoke-test API is removed. iOS/Android no longer install `nativeWatermelonCreateAdapter` JSI bindings.

### Deprecations

### New features

- [Electron] Added `RemoteAdapter` so SQLite can run in Electron's main process over IPC (or any serializable transport). Cherry-picked from [Nozbe/WatermelonDB#1859](https://github.com/Nozbe/WatermelonDB/pull/1859) by [@feznyng](https://github.com/feznyng)

### Fixes

- [LokiJS] Multitab sync issue fix
- [Android] Added linker flag for building with 16kB page alignment
- [Android] Generate `BuildConfig` under AGP 8+ (fixes `cannot find symbol: BuildConfig`)
- [TS] make catchError visible to typescript

### Performance

### Changes

- [Nitro] Native SQLite uses a typed `NitromelonDatabase` HybridObject wrapping the existing C++ `Database`. `react-native-nitro-modules` is an optional peer dependency. The Expo SDK 57 app in `examples/nitro` uses `SQLiteAdapter` with a notes schema, migrations, and a list UI.
- Migrated the JS source from Flow + hand-written `.d.ts` to TypeScript. Implementation under `src/` is now TypeScript, including adapters (SQLite, LokiJS, remote). `yarn typecheck` uses `strict`, `noUnusedLocals`, `noUnusedParameters`, and `exactOptionalPropertyTypes`, and forbids explicit `any`. Tests remain JavaScript.

- ESLint and TypeScript are dedicated required CI jobs on every pull request. Implementation files under `src/` must be TypeScript (JavaScript is only allowed in tests). ESLint uses `@typescript-eslint/recommended` rather than turning core JS rules off by hand.
- Removed the Flow toolchain: `flow-bin`, `eslint-plugin-flowtype`, Babel Flow plugins, `.flowconfig`, and `flow-typed`.
- Metro strips TypeScript for `.ts` sources, and `yarn test:metro-transform` guards that path in CI.

- Updated better-sqlite3 to 13.0.3
- Support for React Native 0.87 and React 19

### Internal

- Updated internal dependencies
- Updated documentation scripts
- [CI] Run JavaScript tests on Node.js 24 only
- [CI] Run iOS tests on macOS 26 / latest stable Xcode / iPhone 17 (iOS 26)
- [CI] Android tests use JDK 21
- [CI] Use latest CocoaPods (1.17) without the old 1.15 / xcodeproj / ethon pins
- Bundle React Native 0.87 with its own Babel preset
