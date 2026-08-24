### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

- SQLite Node adapter (Windows): `getPath()` only recognized Unix (`/…`) and `file:` absolute paths, so a Windows drive-letter path (`D:\…`) got `process.cwd()` prepended a second time, producing an unreachable directory.
- SQLite Node adapter: fixed a real file-handle leak in `DatabaseBridge.setUpWithSchema`/`setUpWithMigrations` — the driver `initialize()` leaves waiting after a schema/migration error was discarded for a new one without closing its still-open handle. Same root cause as upstream [Nozbe/WatermelonDB#1705](https://github.com/Nozbe/WatermelonDB/issues/1705); fixed here via the existing shared-memory-aware `DatabaseDriver.close()` rather than an unconditional `instance.close()`, so it doesn't also close a `cache=shared` in-memory connection another tag still depends on.
- SQLite Node adapter: added `unsafeCloseConnection()` — there was no way for a Node/Electron consumer to release a database's native handle at all (only `unsafeResetDatabase()`, which closes and immediately reopens). Node/Electron only; native (iOS/Android/Windows Nitro) has no such lifecycle to expose.
- Both leaks were invisible on POSIX (unlinking an open file is a no-op there) but on Windows the orphaned handle permanently blocked deleting/reopening the same file — surfaced as every file-backed SQLite Node test failing on Windows.

### Performance

### Changes

- NotesApp Windows renders the Expo NotesApp `src/` UI (shared screen/components/model). List on Windows is `NotesList.windows.tsx`.
- NotesApp Windows: `yarn metro`, `yarn metro:kill`, `yarn build:debug` / `build:release` / `build:all`, `yarn start:debug` / `start:release`.

### Internal

- CI: lint GitHub Actions workflows with actionlint and action-validator (`yarn lint:workflows`) in a separate workflow so a broken `ci.yml` still fails checks.
- CI: native/NotesApp jobs wait for ESLint, TypeScript, and JavaScript tests. `concurrency` cancels superseded PR/master runs (including when a PR is closed).
- CI: run NotesApp Maestro e2e on Android from a Release APK (embedded JS, no Metro). Build and test stay on the same job for now.
- NotesApp Maestro: dismiss the IME before tapping Add (API 29 keyboard covers the composer). `softwareKeyboardLayoutMode: resize`. Consecutive adds wait for the new title; pin/delete use space-free testIDs (Android resource-id) and single taps. Pagination scrolls to `Note #100` after inserts.
- NotesApp Windows e2e: `ScrollView` of page-sized cards so new rows stay in the UIA tree. `addNote` types via `browser.keys()` (same WinAppDriver session as every other command) instead of PowerShell SendKeys — SendKeys required `SetForegroundWindow`, which CI's foreground-lock silently refuses, so the title field stayed empty and Add was a no-op. `textVisible` requires `isDisplayed()`. Windows list keeps off-tree UIA anchors for titles/pin/delete.
- NotesApp Windows e2e: `environment.js` dumps the full UI Automation tree (`browser.getPageSource()`), a screenshot, and the Root session's top-level window list on any test failure (jest-circus `test_fn_failure`), uploaded as a CI artifact (`ci.yml`). Webdriver command logs only show what was asked for, not what was actually on screen. This is what found the real cause of the remaining flakiness: pixel-sampling a failure screenshot showed a hard, exact-pixel edge past which the window was genuinely unpainted (solid black in the file, not a display artifact) — `delete-button-*` and `add-note-button` sat past it, so WinAppDriver could still find and "click" them, but the click landed on screen pixels that were never rendered, while `pin-button-*`/`title-input` sat inside it, which is why pin worked reliably and add/delete did not. Several app-side fixes (resizing the window to the reported screen work area, then to a sibling top-level window's bounds) chased this without success, and one made CI failures worse (`examples/NotesApp_windows/e2e/environment.js` history) before landing on the real cause below — kept the diagnostics capture since it's what surfaces this class of issue at all.
- NotesApp Windows e2e (root cause): GitHub-hosted Windows runners default to a 1024×768 virtual display ([actions/runner-images#2935](https://github.com/actions/runner-images/issues/2935)) — smaller than the app's own `appWindow.Resize({1000, 1000})` default. Fixed at the source in `ci.yml` with `Set-DisplayResolution -Width 1920 -Height 1080 -Force`, a built-in Windows Server `ServerCore` PowerShell cmdlet (not a third-party module) — 1920×1080 is GitHub's own confirmed-working, max-supported resolution on these runners. This replaced all the app-side window-fitting logic above; none of it was necessary once the actual screen is sized correctly.
- NotesApp `title-input` is a normal controlled `TextInput` (`value={title}`) on every platform again. It had been made uncontrolled on Windows only (shadow `titleRef`, `defaultValue`, a `setTimeout`-dispatched Add button) to route around PowerShell SendKeys dropping lowercase characters — a WinAppDriver bug, not a reason to change the production component. Once SendKeys was replaced by `browser.keys()` above, the uncontrolled input was the actual cause of the remaining flakiness (`onChangeText` doesn't reliably fire for driver-injected input on an uncontrolled field), which had been getting patched with a growing pile of readback-and-retry-typing logic in `addNote` instead of being addressed at the source. Reverting to a controlled input let `addNote` shrink back to the same click/type/submit/verify shape as `pinNote`, and made the Windows e2e suite both green and consistently faster (no more retry loops).
- NotesApp Windows: schema v3, 100-note seed, sticky `Q.skip`/`Q.take(20)` pager, and WinAppDriver UI e2e that mirrors the Maestro flows (replacing the Cavy integration host in CI).
- CodeQL: build Java/Kotlin from `native/androidTest` and Swift from `WatermelonTester` so default-setup autobuild is not required.
- Simplified `AGENTS.md` / added Claude Code rules and cwd hooks so agents stop mixing up the library root with `examples/NotesApp`.
- NotesApp: disable the Expo dev menu / FAB / onboarding overlay on launch so Maestro e2e can tap the UI.
- NotesApp: sticky FlashList pager (`Q.skip` + `Q.take(20)`), UI moved under `src/`, Maestro flows for cold start, CRUD, kill-and-relaunch, interaction burst, and pagination.
- Docs: document NotesApp Maestro e2e and call out device e2e as a fork advantage (README + CONTRIBUTING).
- NotesApp Maestro: pagination uses `Q.take` (not `Q.limit`), Load more no longer inserts rows, subscriptions unsubscribe, `sort_order` is used for list order.
- **e2e test coverage (Phase 0)**: Raised iOS XCTest timeout from 100s to 600s, increased Cavy `waitTime` from 4s to 30s, and created `src/adapters/__tests__/sqliteTests/` with `helpers.js`, `index.js`, `migrations.js`, `batches.js`, `concurrency.js`, `cleanup.js`, and `databaseLevel.js`. Wired the new suite into `src/adapters/sqlite/test.js` and `integrationTest.js` so all 5 native consumers (Jest/node, Jest/better-sqlite3, LokiJS, iOS native, Android native, Windows native) run the new file-backed tests.

- Docs Pages workflow builds with Yarn 4 inside `docs-website` (root `yarn docs:build` needs a root install) and only runs when docs-related paths change.
- Migrate the repo and example apps from Yarn Classic to Yarn 4.18 (`node-modules` linker, pinned via `packageManager` / `.yarn/releases`).
- Drop `patch-package` from the library root. There was no root `patches/` directory; the Expo `expo-modules-jsi` workaround stays in the example apps.
- Pin the Babel 7 toolchain (`@babel/core`, `@babel/cli`, plugins, `@babel/runtime`) to the latest 7.x (7.29.7 / 7.29.8).
