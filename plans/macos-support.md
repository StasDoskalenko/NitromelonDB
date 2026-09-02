# Plan: macOS support via react-native-macos

Status: **proposal / not started**
Owner: TBD
Tracking issue: [StasDoskalenko/NitromelonDB#49](https://github.com/StasDoskalenko/NitromelonDB/issues/49)
Related upstream work:
- [Nozbe/WatermelonDB#1967](https://github.com/Nozbe/WatermelonDB/pull/1967) — Mac Catalyst path fix (Application Support to avoid the TCC prompt). Related but **not** the same target.
- [drafto watermelondb 0.28 patch](https://github.com/JakubAnderwald/drafto/blob/main/patches/%40nozbe__watermelondb%400.28.0.patch) — community patch referenced from the issue.

Enabling dependency: [nitro#1280 "Add macOS support (via `:osx` podspec target)"](https://github.com/mrousavy/nitro/commit/793266283e37f7e6a0257c0b3461418cc1c2f110), shipped in `react-native-nitro-modules@0.35.9`.

---

## 1. Goal

Ship first-class **[react-native-macos](https://github.com/microsoft/react-native-macos)** (AppKit, New Architecture) support for the native SQLite adapter, so a macOS RN app can `import` NitromelonDB and get the same reactive SQLite it gets on iOS/Android/Windows.

Model the effort on how **Windows** was added *process-wise* (separate example app, its own RN pin, autolink config, CI, shared UI), but implement it *technically* on the **iOS/CocoaPods/Objective-C++** path — because react-native-macos is "React Native on iOS, with AppKit instead of UIKit" and consumes the same podspec + Nitrogen iOS output. No DLL/vcxproj/NitroModules-shim machinery like Windows needs.

### Non-goals

- Mac Catalyst as a **first-class, tested** product. We ship the `TARGET_OS_MACCATALYST` path fix (Phase 1.3, from WatermelonDB#1967) and document Catalyst as **experimental / best-effort** in the READMEs — but the tested, supported target is react-native-macos. We don't stand up a Catalyst example app or CI.
- A LokiJS/web fallback story for macOS (macOS uses the native adapter).
- Reworking the Nitro spec surface, the shared SQLite engine, or the JS adapter API.

### Definition of done

- `pod install` succeeds for a `react-native-macos@0.81.8` target with `nitromelondb` autolinked.
- `NotesApp_macos` (sandboxed) runs on macOS: create / query / observe / batch / delete-database all work against real native (vendored 3.46.0) SQLite.
- Data persists across cold launch, stored under Application Support in the sandbox container (TCC-prompt-free).
- CI builds the macOS example and runs the XCUITest flows ported from Maestro.
- Docs + README updated (macOS supported; Catalyst experimental); issue #49 closed.

---

## 2. Why this is mostly an iOS problem, not a Windows one

The library selects a native platform **at compile/link time**: `native/shared/DatabasePlatform.h` is a pure interface, and each build target links exactly one implementation. react-native-macos compiles the **same CocoaPods pod** as iOS, just for the `osx` SDK.

| Concern | iOS today | macOS (this plan) |
| --- | --- | --- |
| Build system | CocoaPods (`NitromelonDB.podspec`) | Same pod, add `:osx` platform |
| Platform impl | `native/ios/NitromelonDB/DatabasePlatformIOS.mm` | Same file, `#if TARGET_OS_OSX` branches (rename to `Apple`) |
| SQLite | system `libsqlite3` (`s.libraries = 'sqlite3'`) | **Vendored** `native/vendor/sqlite/sqlite3.c` — see D7; iOS/tvOS switch too |
| Nitro registration | `nitrogen/generated/ios/…Autolinking.mm` `+load` | Same generated file, compiled for osx |
| JS module load | `NitroModules.createHybridObject('Nitromelon')`, `.native.ts` variants | **Unchanged** — macOS resolves `.native.ts` too |

Contrast with Windows, which needed a standalone `.vcxproj`/`.sln`, a hand-written `REACT_MODULE` TurboModule to stand in for the missing Nitro autolink, header shims, and a `windows-autolink.js`. **None of that applies to macOS.**

### Key implication for the JS layer

The library has **no `.ios.ts` vs `.macos.ts` split** and doesn't need one. macOS is a "native" RN platform, so Metro resolves the existing `index.native.ts` files:

- `src/adapters/sqlite/makeDispatcher/index.native.ts` (Nitro sync dispatcher)
- `src/utils/common/isRN/index.native.ts`
- `src/utils/common/randomId/randomId.native.ts`

Expected library JS changes: **none** (verify only).

---

## 3. Open decisions (resolve before/while starting)

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | Directory naming | Keep `native/ios/`, just add `:osx`; **or** rename `native/ios/` → `native/apple/` and `DatabasePlatformIOS.mm` → `DatabasePlatformApple.mm` per [RNM guidance](https://microsoft.github.io/react-native-macos/docs/guides/native-development) | **RESOLVED → rename to `native/apple/`.** It's no longer iOS-only and the rename is cheap now, painful later. Update podspec glob, `make.mjs`, `nitro.json` `ignorePaths`, and the `WatermelonDB.h`/`JSIInstaller.h` header paths. |
| D2 | DB storage location on macOS | `NSDocumentDirectory` (as iOS) vs `NSApplicationSupportDirectory` | **Application Support** under `#if TARGET_OS_OSX` (and Catalyst), mirroring WatermelonDB#1967, to stay TCC-prompt-free on non-sandboxed builds. Keep iOS on Documents. |
| D3 | Example app framework | Expo (like `NotesApp`) vs bare react-native-macos (like `NotesApp_windows`) | **Bare `react-native-macos` app** in `examples/NotesApp_macos`, reusing `examples/NotesApp/src` via Metro — Expo macOS support is not a fit here. |
| D4 | RN version for the macOS example | Match `NotesApp` (0.86.x) vs whatever `react-native-macos` supports | **RESOLVED → RN `0.81.8` + `react-native-macos@0.81.8`** (same minor, per RNM guidance). Scaffold via `@react-native-community/cli init` from the target dir. Note the three-way example skew: Expo iOS/Android `0.86`, Windows `0.84.1`, macOS `0.81.8`. |
| D5 | Minimum macOS deploy target | 11.0 / 12.0 / 13.0 | **RESOLVED → `:osx => "11.0"`** (RNM floor = Big Sur 11). Bump only if `NitroModules.podspec` forces a higher `:osx` floor — verify in Phase 0. |
| D6 | Nitro spec `macos` key | Add `macos: 'c++'` to `HybridObject<…>` + `nitro.json` vs leave as-is | **Leave as-is first**, verify macOS autolinks via the iOS-generated output; only add a `macos` section if Nitrogen requires it (see Phase 2). |
| D7 | sqlite provenance on Apple | System `libsqlite3` (as iOS today) vs **vendored** `native/vendor/sqlite/sqlite3.c` (as Android/Windows) | **RESOLVED → vendored on all Apple platforms.** Compile our `sqlite3.c` (v3.46.0) into the pod and drop `s.libraries = 'sqlite3'`, giving one deterministic version + compile-flag set across all four platforms and unblocking SQLCipher. This also changes **iOS/tvOS** (away from system sqlite) — call it out in the changelog. See Phase 1.1. |

---

## 4. Phases

### Phase 0 — Verify the toolchain (spike, ~half day)

Prove the dependency chain supports macOS before touching the library.

**Already established (not open):**
- **New Architecture is aligned.** react-native-macos ships New Arch on by default since [microsoft/react-native-macos#2688](https://github.com/microsoft/react-native-macos/pull/2688), and NitromelonDB is **New-Arch-only** — so there is no old-bridge story to support. This was the biggest feared risk; it's a non-issue.
- **Versions chosen (D4/D5):** RN `0.81.8` + `react-native-macos@0.81.8` (matched minor); min macOS **11.0 (Big Sur)**.

**Still to verify:**
- [ ] Pick a `react-native-nitro-modules` version that (a) is `>= 0.35.9` (macOS `:osx` target) **and** (b) is compatible with RN `0.81.8`. Confirm `NitroModules.podspec` in `node_modules` includes `:osx`, and read its `:osx` min (may raise D5's `11.0`). Then **bump the library peer floor** in `package.json` from `>=0.35.2` accordingly.
- [ ] **The one real unknown (D6):** scaffold a throwaway `react-native-macos@0.81.8` app (`@react-native-community/cli init`), add a trivial Nitro module, and confirm the Nitrogen autolink registration (`+load` in `…Autolinking.mm`) fires on the `osx` target so `createHybridObject` resolves. If it doesn't, add a `macos` block to `nitro.json` / the `HybridObject<…>` type and retry. *(User note: this is a "learn by doing" item — accept that we may discover Nitrogen quirks here.)*

Exit criterion: a Nitro hybrid object is callable from JS in a bare `react-native-macos@0.81.8` app.

### Phase 1 — Library native (the core)

Make the pod compile and behave for the `osx` SDK.

1. **Podspec** (`NitromelonDB.podspec`)
   - [ ] `s.platforms = { :ios => "15.1", :tvos => "15.1", :osx => "11.0" }` (D5; raise `:osx` if `NitroModules.podspec` requires it).
   - [ ] If renaming (D1), update `s.source_files` / `s.public_header_files` / `s.private_header_files` from `native/ios/**` → `native/apple/**`.
   - [ ] **Vendor sqlite on Apple (D7).** Add `native/vendor/sqlite/*.{c,h}` to `s.source_files`, keep `native/vendor/sqlite/*.h` in `s.private_header_files`, add `native/vendor/sqlite` to the pod's `HEADER_SEARCH_PATHS`, and **remove `s.libraries = 'sqlite3'`** so we no longer link Apple's system copy. Mirrors what Android (`android/CMakeLists.txt`) and Windows (`NitromelonDB.vcxproj`) already do with the same 3.46.0 amalgamation.
   - [ ] Update the podspec comment block (lines ~5-7) that currently says "iOS links the system sqlite3; do not compile native/vendor/sqlite into this pod" — that guidance is now reversed for all Apple targets.
   - [ ] **Header resolution.** The shared code includes sqlite with angle brackets — `native/shared/Database.h:11` and `native/shared/Sqlite.h:4` both do `#include <sqlite3.h>`. Today that resolves to the SDK header on Apple; after vendoring it must resolve to `native/vendor/sqlite/sqlite3.h` (v3.46.0). Order the pod `HEADER_SEARCH_PATHS` so the vendored dir wins over the SDK, otherwise you compile against the SDK header while linking the vendored `.c` (or vice versa) — a silent version mismatch. Confirm `sqlite3_libversion()` reports `3.46.0` at runtime as a check.
   - [ ] Compile flags: keep `-Os` (already set for simdjson). Add the sqlite compile-time options we rely on cross-platform so Apple matches Android/Windows — diff `android/CMakeLists.txt` / the vcxproj for any `SQLITE_ENABLE_*` / thread-mode defines and replicate them via `s.compiler_flags` or `pod_target_xcconfig` `GCC_PREPROCESSOR_DEFINITIONS`. Goal: identical SQLite feature set on every platform.
   - [ ] **Symbol-collision guard.** Because we now statically compile our own `sqlite3` symbols, an app that also pulls a `sqlite3`/SQLCipher pod can hit duplicate-symbol / `redefinition of 'sqlite3_mem_methods'` errors (same failure class documented in the [encryption plan](database-encryption.md)). Compile statically, keep headers private, include via quoted relative paths, and add a test app that *also* has another sqlite pod.
   - [ ] Verify `install_modules_dependencies(s)`, `React-Core`/`React-jsi`/`React-callinvoker`, and `add_nitrogen_files(s)` all resolve on the osx target under react-native-macos.

2. **Platform implementation** (`native/apple/…/DatabasePlatformApple.mm`, formerly `DatabasePlatformIOS.mm`)
   - [ ] **`onDestroy` must work under New-Arch bridgeless** (we're New-Arch-only, and RNM defaults to bridgeless). The current hook subscribes to `RCTBridgeWillReloadNotification` — a *bridge* concept that may not fire under bridgeless. Verify it still posts; if not, switch to a bridgeless-safe signal (e.g. `RCTTriggerReloadCommandNotification` / the React instance lifecycle) — and note this likely improves the **iOS** bridgeless path too, not just macOS.
   - [ ] Everything else (`NSFileManager`, `NSDocumentDirectory`, `NSMutableDictionary`, `NSNotificationCenter`, `std::mutex` sync-json store) is Foundation and compiles unchanged on macOS.
   - [ ] `onMemoryAlert` is already a TODO no-op on iOS; leave as-is (macOS has `NSProcessInfo`/`dispatch_source` memory pressure APIs — out of scope).

3. **DB path resolution** (`resolveDatabasePath`, incorporating WatermelonDB#1967)
   - [ ] Add a branch so macOS (and Catalyst) resolve under **Application Support**, private to the bundle and exempt from TCC:

```objectivecpp
std::string resolveDatabasePath(std::string path) {
#if TARGET_OS_OSX || TARGET_OS_MACCATALYST
    NSSearchPathDirectory dir = NSApplicationSupportDirectory;
#else
    NSSearchPathDirectory dir = NSDocumentDirectory;
#endif
    NSError *err = nil;
    NSURL *baseUrl = [NSFileManager.defaultManager URLForDirectory:dir
                                                          inDomain:NSUserDomainMask
                                                 appropriateForURL:nil
                                                            create:YES   // AppSupport may not exist yet
                                                             error:&err];
    // ... existing error handling + "<path>.db" append ...
}
```

   - [ ] Deliberately **no** legacy-file probe/migration (probing `~/Documents` would trigger the very TCC prompt we avoid — see #1967 rationale). Note this in the changelog for anyone shipping iOS + macOS of the same app.
   - [ ] `deleteDatabaseFile` already unlinks the main file; confirm parity with Android/Windows WAL/SHM unlinking if we want it here too (tracked separately in the e2e plan).

4. **`app.plugin.js` / `plugin/withNitromelonDB.js`** — Expo config plugin. Not used by a bare macOS app; leave untouched (verify it doesn't assume iOS-only when a consumer app also targets macOS via Expo prebuild, which is out of scope).

### Phase 2 — JS / Nitro codegen (verify, likely no-op)

- [ ] Regenerate specs (`yarn specs`) after any native rename and confirm `nitrogen/generated/ios/*` still registers `"Nitromelon"`.
- [ ] Decide D6: does `HybridObject<{ ios: 'c++'; android: 'c++' }>` in `src/nitro/Nitromelon.nitro.ts` need a `macos` key? Nitro's platform union historically is `ios | android`, with macOS served by the iOS output. **Only** add `macos`/a `nitro.json` macOS block if Phase 0 shows Nitrogen won't otherwise register on osx.
- [ ] Confirm no new `.macos.ts` files are needed in `src/` (the `.native.ts` variants already cover macOS).
- [ ] `yarn typecheck` + `yarn eslint` clean.

### Phase 3 — Packaging (published tarball)

The npm package contents are assembled by `scripts/make.mjs`, not `package.json#files`.

- [ ] `scripts/make.mjs`: update the native copy list if `native/ios` → `native/apple` (D1). Ensure the renamed dir and podspec ship.
- [ ] `scripts/published-package.mjs`: no macOS-specific export needed (macOS reuses the iOS podspec + `nitrogen/`). Confirm the `.podspec` and `nitrogen/generated/ios/**` are already in the published set (they are, for iOS).
- [ ] `react-native.config.js`: macOS autolinks through CocoaPods via the podspec — no `dependency.platforms.macos` entry required (unlike Windows). Verify nothing needs adding.
- [ ] Bump `peerDependencies.react-native-nitro-modules` floor to `>=0.35.9` (from Phase 0).

### Phase 4 — Example app (`examples/NotesApp_macos`)

Mirror the `NotesApp_windows` split: a separate package with its own RN pin, sharing UI from `examples/NotesApp/src`.

- [ ] Scaffold a bare `react-native-macos` app (`npx react-native-macos-init` in a fresh RN app, or the current recommended flow) into `examples/NotesApp_macos`.
- [ ] `package.json`: pin RN + `react-native-macos` (D4); `"nitromelondb": "link:../.."`; `react-native-nitro-modules` as a real dependency at `>=0.35.9`.
- [ ] `metro.config.js`: resolve the library from the monorepo root and watch `../NotesApp/src`, exactly like `NotesApp_windows/metro.config.js`.
- [ ] Reuse `examples/NotesApp/src` for the UI. Add `*.macos.tsx` component overrides **only** where AppKit/desktop layout differs, matching the existing `NotesList.windows.tsx` / `ComposerDock.windows.tsx` pattern.
- [ ] `react-native.config.js`: only add config if autolink needs a nudge (bare RNM usually autolinks pods automatically — verify).
- [ ] **Enable App Sandbox** (App Store posture) on the example's entitlements. This is the realistic distribution mode and it directly validates the D2 Application Support path (sandboxed container → `~/Library/Containers/<bundle>/Data/Library/Application Support`, TCC-free).
- [ ] `pod install` under `examples/NotesApp_macos/macos`, build, run. Smoke-test CRUD + persistence + delete-database.
- [ ] Add `yarn` scripts mirroring the Windows ones (`build`, `start`, and an e2e entry — see Phase 5).

### Phase 5 — Tests & CI

- [ ] **Native/library tests:** run the same Cavy `integrationTests.native` suite in the macOS example (as iOS does), rather than standing up a second XCTest project just for the engine.
- [ ] **e2e (decided): XCUITest/XCTest replicating the Maestro flows** — the macOS analog of how `NotesApp_windows` re-implements the Maestro scenarios via WinAppDriver. Port the flows under `examples/NotesApp/maestro/` (cold-start, add-pin-delete, kill-and-relaunch, etc.) to AppKit XCUITest against `NotesApp_macos`. XCUITest drives AppKit apps and runs on the `macos-*` CI runners.
- [ ] **CI (`.github/workflows/`):** add a macOS job (runners are already `macos-*` for iOS). Build `examples/NotesApp_macos`, run `pod install`, compile, and run the XCUITest suite. Keep it required-optional until stable.
- [ ] `yarn lint:workflows` after editing Actions YAML.

### Phase 6 — Docs & housekeeping

- [ ] README + `docs-website/docs/docs/README.md`: move macOS from roadmap to supported; document min-osx (11 / Big Sur), the Application Support path, and the "no auto-migration from Documents" caveat. Add a short **"Mac Catalyst: experimental"** note (path fix ships, but Catalyst is untested/best-effort).
- [ ] `docs-website/docs/docs/Implementation/DatabaseAdapters.md`: mark RN macOS adapter as implemented.
- [ ] `CHANGELOG-Unreleased.md`: add macOS support + the peer bump.
- [ ] `AGENTS.md` / `CLAUDE.md`: add a `examples/NotesApp_macos` row and its commands, matching the Windows entry.
- [ ] Close issue #49 referencing this plan + the PR.

---

## 5. Risks & unknowns

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **Nitrogen `+load` autolink doesn't fire on the osx target** | Medium/High — module never registers, `createHybridObject('Nitromelon')` throws | The remaining Phase 0 spike item. If it fails, add a `macos` block to `nitro.json` / `HybridObject<…>` (D6) and retry. New Arch itself is **not** a risk (RNM default-on + our module is New-Arch-only). |
| **Example RN version skew** — Expo iOS/Android `0.86`, Windows `0.84.1`, macOS `0.81.8` sharing `NotesApp/src` | Low — `0.81.8` expected to run the `0.86` UI out of the box | Same pattern Windows already tolerates; add `*.macos.tsx` overrides only if something breaks. |
| `RCTBridgeWillReloadNotification` / bridge APIs differ under RNM bridgeless/New Arch | Medium — `onDestroy` reload hook breaks | Guard with `#if TARGET_OS_OSX`; fall back to a no-op or an RNM-appropriate reload signal. Learn during Phase 1. |
| Non-sandboxed macOS build hits TCC on `~/Documents` | Medium — first-launch prompt / failure | Application Support branch (Phase 1.3). |
| Renaming `native/ios` → `native/apple` breaks stale references | Low/Medium | Grep every consumer: podspec, `make.mjs`, `nitro.json` `ignorePaths`, header `#import`s, docs. Do it as one atomic commit + `yarn build`/`yarn specs`. |
| **Vendoring sqlite changes iOS/tvOS too** (D7) — they move off Apple's system copy | Medium — behavior/perf could shift for existing iOS users | Land vendoring as its own PR (see §6.3) with the full iOS test suite green; assert `sqlite3_libversion() == 3.46.0`; changelog note. |
| Duplicate-symbol clash when the app also has a sqlite/SQLCipher pod | Medium — link failure | Static compile, private headers, quoted relative includes; test app with a second sqlite pod (Phase 1.1). |
| `<sqlite3.h>` resolves to SDK header instead of vendored | Medium — header/lib version mismatch | Order `HEADER_SEARCH_PATHS` so the vendored dir wins; runtime version assert (Phase 1.1). |
| No Maestro path for macOS e2e | Low | Use the integration-test-on-launch gate (Phase 5). |

---

## 6. Suggested commit/PR breakdown

Each independently mergeable, to avoid the "big PR rots" failure mode:

1. **Spike doc / Phase 0 findings** (no code, or a throwaway branch) — records that Nitro autolinks on macOS.
2. **`native/ios` → `native/apple` rename** (D1) — pure move + reference updates, `yarn build && yarn specs` green, iOS still builds. No behavior change.
3. **Vendor sqlite on Apple** (D7) — compile `native/vendor/sqlite/sqlite3.c` into the pod, drop `s.libraries = 'sqlite3'`, fix header search order. **Ships on iOS/tvOS by itself** (no macOS yet) so the sqlite-provenance change is validated against the existing iOS test suite in isolation, decoupled from the new-platform risk. Assert `3.46.0` at runtime.
4. **Podspec `:osx` + `DatabasePlatformApple.mm` `TARGET_OS_OSX` branches + Application Support path** — the actual macOS enablement, now building on the already-vendored sqlite.
5. **`examples/NotesApp_macos`** — example app, Metro/UI wiring, `*.macos.tsx` overrides.
6. **CI job + integration gate.**
7. **Docs, changelog, peer-dep bump, AGENTS/CLAUDE updates, close #49.**
