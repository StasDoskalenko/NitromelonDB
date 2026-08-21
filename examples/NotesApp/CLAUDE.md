# You are in the EXAMPLE APP

Folder: `examples/NotesApp`
Library (do not pretend this is it): `../..` → `src/` and `native/`

This app consumes the library. It is not the library.

## Commands (run here)

Before `expo run:*` or Metro start, check if Metro is already running on port **8081** (terminals, `lsof -i :8081`, or `curl -s http://localhost:8081/status`). Reuse it — do not start a second server.

```bash
yarn expo run:ios
yarn expo run:android
yarn start:e2e
maestro test maestro/
maestro test maestro/cold-start.yaml
```

For Maestro, use `yarn start:e2e` (`expo start --dev-client --no-dev`), not plain `yarn start`.

App id: `com.nitromelondb.example`

If you need to change database code, that lives in `../../src/` and `../../native/`, then rebuild this app.

App UI lives under `src/` (`screens/`, `components/`, `hooks/`, `model/`). Root `App.tsx` re-exports `src/App.tsx`.
