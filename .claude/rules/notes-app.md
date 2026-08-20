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
maestro test maestro/
```

Before `expo run:*` or `yarn start`: check Metro on port **8081** is not already running (`lsof -i :8081` or `curl -s http://localhost:8081/status`). Reuse an existing dev server; do not start a second one.

- App id: `com.nitromelondb.example`
- Schema / models: `examples/NotesApp/model/`
- UI: `examples/NotesApp/App.tsx`
- Flows: `examples/NotesApp/maestro/*.yaml`
- Not Expo Go. Rebuild after native/Nitro changes (`yarn expo run:ios`).
