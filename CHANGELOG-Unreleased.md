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
- NotesApp Windows e2e: the environment now resizes the app window to the CI session's actual screen work area on launch. Diagnosed from a `getPageSource()`/screenshot dump captured on test failure (see below): UI Automation reports elements by the window's logical layout regardless of what's actually painted, and on this CI session the real screen is smaller than the app's default window size — pixel-sampling the failure screenshot showed a hard, exact-pixel edge (x≈887, y≈638 of a reported 986×781 window) past which everything is unrendered black. `delete-button-*` and `add-note-button` both sit past that edge, so WinAppDriver could still find and "click" them, but the click landed on real screen pixels that were never rendered — while `pin-button-*` and `title-input` straddle or sit inside the edge, which is why pin worked reliably and delete/add did not.
- NotesApp Windows e2e: `environment.js` dumps the full UI Automation tree (`browser.getPageSource()`) and a screenshot on any test failure (jest-circus `test_fn_failure`), uploaded as a CI artifact (`ci.yml`). Webdriver command logs only show what was asked for, not what was actually on screen — this is what surfaced the window-size issue above instead of another round of guessing. Also dumps the Root session's top-level window list/bounds, to rule out a sibling window (RDP toolbar, notification) overlapping the app rather than the app itself failing to paint.
- NotesApp Windows e2e: the first resize attempt above silently did nothing — its own code used bare `global` inside `environment.js`, which runs in Jest's worker process, not the sandboxed per-test-file `vm` context that `this.global` (and therefore plain `global` inside actual test files) refers to. Fixed to `this.global`, and switched `setWindowRect` (W3C-only) to `setWindowSize` (routes correctly via `browser.isW3C`, which is `false` for WinAppDriver — it predates the W3C WebDriver spec). Once the resize actually started taking effect, resizing to the full screen work area introduced new flakiness in previously-reliable tests; capped the target to `min(screen, 1000×1000)` — the app's own requested launch size — so this only ever shrinks the window to fit a constrained CI screen, and added a settle-wait (`subtitle` visible again) after resizing before any test interacts with the app.
- NotesApp Windows e2e: `PrimaryScreen.WorkingArea` still wasn't the real constraint — resizing to it (1024×720) left the same class of failure. The top-level-window diagnostics above (added specifically to test whether a sibling window was overlapping the app rather than the app failing to paint) found the actual answer: GitHub's own `hosted-compute-agent` window, stable and identical across two diagnostics in the same run, with noticeably smaller bounds (1044×635) than what `WorkingArea` reported. `setup()` now also fits the window inside any other top-level window at least 400×400 (filtering out a dev machine's own unrelated windows — one was picked up locally and broke an unrelated test before this filter existed), gated to `process.env.CI` only, since `screenWorkArea()` alone was already reliable locally and this is specifically a CI-session quirk.
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
