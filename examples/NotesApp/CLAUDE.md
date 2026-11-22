# examples/NotesApp — Expo example app (iOS/Android), not the library

The library is `../..` (`src/`, `native/`). Database changes go there, then rebuild this app. This is a development build, not Expo Go: rebuild after native/Nitro changes; JS-only changes just need a Metro reload.

## Run (from this folder)

Check port **8081** first and reuse a running Metro.

```bash
yarn expo run:ios       # or: yarn expo run:android
```

## Maestro e2e

```bash
yarn start:e2e          # expo start --dev-client --no-dev
maestro test maestro/
maestro test maestro/cold-start.yaml
```

- Use `yarn start:e2e`, not plain `yarn start` (that keeps JS dev mode on).
- App id in every flow: `com.nitromelondb.example`.
- `maestro/sync.yaml` needs the sync server: `cd ../sync-server && yarn install && yarn start:notes-app` (port 3000; on an Android emulator also `adb reverse tcp:3000 tcp:3000`). CI scripts start it themselves.
- CI runs the flows on Android against a Release APK with no Metro (`scripts/ci-notesapp-android-maestro.sh`).
- `maestro-encryption/` is not a suite: `scripts/ci-notesapp-ios-encryption-upgrade.sh` runs its flows one by one while switching between the plain build and the encryption build (`NITROMELONDB_ENCRYPTION=1` at `pod install`), checking the database file between steps. See its `README.md`. The encryption build shows `encryption-status` and `encrypt-button` in the header; the plain build shows neither.
- The same scenarios run on Windows through WinAppDriver (`../NotesApp_windows/e2e/`). If you change a flow, or a `testID` a flow relies on, update the Windows test too.
- Maestro MCP, if connected: `list_devices` → `inspect_screen` before tapping → `cheat_sheet` before writing new YAML → `run`. Do not use Maestro Cloud unless asked.

## Shared UI

`src/` (screens, components, hooks, model) is also the Windows app's UI. Windows overrides are `*.windows.tsx` (`NotesList.windows.tsx` is a ScrollView list; iOS/Android use FlashList). Root `App.tsx` re-exports `src/App.tsx`.

## Seed + list (do not thrash)

Correct pattern in `src/hooks/useNotes.ts` + `src/screens/NotesScreen.tsx`:

1. One effect: `experimentalSubscribeToCount` + async seed (100 notes, `localStorage` gate).
2. One effect: list query with `Q.skip((page - 1) * pageSize)` + `Q.take(pageSize)` + `experimentalSubscribeWithColumns` (FlashList on iOS/Android, `NotesList.windows.tsx` on Windows).
3. Sticky pager (Previous / Next) changes `page` only. Never inserts rows. Never grow the list with cumulative `Q.take`.

After seed writes, observers emit again. A brief count of `0` is fine. Do **not** add refs to “win” a race with the first subscription callback. Maestro waits for `100 notes`.
