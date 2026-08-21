---
paths:
  - "examples/NotesApp/**"
---

# NotesApp (example, not the library)

Work in `examples/NotesApp`. The library is `../../` (`src/`, `native/`).

```bash
cd examples/NotesApp
yarn expo run:ios
yarn expo run:android
yarn start:e2e
maestro test maestro/
```

Before `expo run:*` or Metro start: check port **8081** (`lsof -i :8081` or `curl -s http://localhost:8081/status`). Reuse an existing server; do not start a second one.

For Maestro, start Metro with **`--no-dev`**: `yarn start:e2e` (or `yarn expo start --dev-client --no-dev`). Do not use plain `yarn start` for e2e.

- App id: `com.nitromelondb.example`
- Schema / models: `examples/NotesApp/src/model/`
- UI: `examples/NotesApp/src/` (`screens/`, `components/`, `hooks/`)
- Flows: `examples/NotesApp/maestro/*.yaml`
- Not Expo Go. Rebuild after native/Nitro changes (`yarn expo run:ios`).

## Seed + list (do not thrash)

Correct pattern in `src/hooks/useNotes.ts` + `src/screens/NotesScreen.tsx`:

1. One effect: `experimentalSubscribeToCount` + async seed (100 notes, `localStorage` gate).
2. One effect: FlashList query with `Q.skip((page - 1) * pageSize)` + `Q.take(pageSize)` + `experimentalSubscribeWithColumns`.
3. Sticky pager (Previous / Next) changes `page` only. Never inserts rows. Never grow the list with cumulative `Q.take`.

After seed writes, observers emit again. A brief count of `0` is fine. Do **not** add refs to “win” a race with the first subscription callback. Maestro waits for `100 notes`.
