### Highlights

### BREAKING CHANGES

- Minimum supported Node.js version is now 22.x (required by React Native 0.87)
- [iOS] Minimum deployment target is now iOS 15.1
- [Android] Minimum SDK version is now 24

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

- Started migrating the JS source from Flow + hand-written `.d.ts` to TypeScript. `src/utils`, `src/types`, `src/Schema`, `src/RawRecord`, `src/QueryDescription`, `src/Model`, `src/Collection`, `src/Query`, `src/Relation`, `src/Database`, `src/decorators`, `src/observation`, `src/react`, `src/diagnostics`, `src/sync`, and the public entry barrels (`src/index`, `src/hooks`, `src/DatabaseProvider`) are now TypeScript. `yarn typecheck` uses `strict`, `noUnusedLocals`, `noUnusedParameters`, and `exactOptionalPropertyTypes`, and forbids explicit `any`. Flow and tslint are gone; leftover tslint config/deps were removed.
- CI runs a dedicated TypeScript job (`yarn typecheck` + `yarn test:typescript`) in addition to `ci:check`.
- Metro now strips TypeScript (not Flow) for `.ts` sources, and `yarn test:metro-transform` guards that path in CI.
- ESLint now lints implementation `.ts` files (`@typescript-eslint/no-explicit-any`) instead of ignoring all TypeScript.

- Updated better-sqlite3 to 13.0.3
- Support for React Native 0.87 and React 19
- [iOS] Install JSI bindings via `RCTTurboModuleWithJSIBindings` (bridgeless / New Architecture). `RCTCxxBridge` is no longer used.

### Internal

- Updated internal dependencies
- Updated documentation scripts
- [CI] Run JavaScript tests on Node.js 24 only
- [CI] Run iOS tests on macOS 26 / latest stable Xcode / iPhone 17 (iOS 26)
- [CI] Android tests use JDK 21
- [CI] Use latest CocoaPods (1.17) without the old 1.15 / xcodeproj / ethon pins
- Bundle React Native 0.87 with its own Babel preset (Flow parser cannot parse RN's TypeScript-in-JS)
