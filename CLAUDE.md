# STOP. Read this every time.

This git repo is a **library**, not an app.

- **Library root** = this folder. Code: `src/` `native/`. Commands: `yarn` `yarn test` `yarn build`.
- **Example app** = `examples/NotesApp`. That is a different package. `cd` there first.

Do not run Expo or Maestro from the library root.
Do not edit `dist/` or `nitrogen/`.

## Run the iOS app

Before `expo run:ios` / `expo start`, check if Metro is already running on port **8081** (open terminals, `lsof -i :8081`, or `curl -s http://localhost:8081/status`). Reuse it. Do not start a second dev server.

```bash
cd examples/NotesApp
yarn expo run:ios
```

Android: `yarn expo run:android` (same folder).

## Maestro e2e

```bash
cd examples/NotesApp
maestro test maestro/
```

One flow: `maestro test maestro/cold-start.yaml`

App id: `com.nitromelondb.example`

## Maestro MCP

```bash
claude mcp add maestro -- maestro mcp
```

Then: `list_devices` → `inspect_screen` → `cheat_sheet` (before new YAML) → `run`.
Project MCP config is already in `.mcp.json`.
