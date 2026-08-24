### Highlights

### BREAKING CHANGES

### Deprecations

### New features
- `useModel`/`useQuery`/`useObservable` hooks (`nitromelondb/hooks` or `nitromelondb/react`) as a hooks-based alternative to `withObservables`. Built on the existing Rx-free `experimentalSubscribe*` methods; re-renders on record/query changes without cloning records — see [docs](https://stasdoskalenko.github.io/NitromelonDB/docs/Hooks).

### Fixes

### Performance
- `Query#experimentalSubscribeWithColumns`/`observeWithColumns`: multiple subscribers observing the same query with the same `columnNames` (in any order) now share one underlying subscription (and one re-fetch on change) instead of each running its own, via a new `KeyedSharedSubscribable` utility — the same `shareReplay`-style sharing `Query#observe`/`experimentalSubscribe` already got from `SharedSubscribable`.

### Changes

- NotesApp Windows renders the Expo NotesApp `src/` UI (shared screen/components/model). List on Windows is `NotesList.windows.tsx`.
- NotesApp Windows: `yarn metro`, `yarn metro:kill`, `yarn build:debug` / `build:release` / `build:all`, `yarn start:debug` / `start:release`.

### Internal

- CI: lint GitHub Actions workflows with actionlint and action-validator (`yarn lint:workflows`) in a separate workflow so a broken `ci.yml` still fails checks.
- CI: native/NotesApp jobs wait for ESLint, TypeScript, and JavaScript tests. `concurrency` cancels superseded PR/master runs (including when a PR is closed).
- CI: run NotesApp Maestro e2e on Android from a Release APK (embedded JS, no Metro). Build and test stay on the same job for now.
- NotesApp Maestro: dismiss the IME before tapping Add (API 29 keyboard covers the composer). `softwareKeyboardLayoutMode: resize`. Consecutive adds wait for the new title; pin/delete use space-free testIDs (Android resource-id) and single taps. Pagination scrolls to `Note #100` after inserts.
- NotesApp Windows e2e: `ScrollView` of page-sized cards so new rows stay in the UIA tree. `addNote` types via `browser.keys()` (same WinAppDriver session as every other command) instead of PowerShell SendKeys — SendKeys required `SetForegroundWindow`, which CI's foreground-lock silently refuses, so the title field stayed empty and Add was a no-op. `textVisible` requires `isDisplayed()`. Windows list keeps off-tree UIA anchors for titles/pin/delete.
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
