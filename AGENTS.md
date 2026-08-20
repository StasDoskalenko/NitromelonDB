# AGENTS.md

NitromelonDB (`nitromelondb`) is a reactive SQLite database for React Native and web — a maintained fork of WatermelonDB. Nitro / New Architecture only. Docs: https://stasdoskalenko.github.io/NitromelonDB/

This repo is a **library** plus **separate example apps**. Do not mix them up.

| What | Where | Commands |
| --- | --- | --- |
| Library | git root (`src/`, `native/`) | `yarn` · `yarn test` · `yarn build` |
| iOS/Android example | `examples/NotesApp` | `cd examples/NotesApp && yarn expo run:ios` |
| Windows example | `examples/NotesApp_windows` | `cd examples/NotesApp_windows && yarn windows` |

Never run Expo, Metro, or Maestro from the library root. NotesApp is not the published package.

## Layout

- `src/` — library TypeScript (this is what apps import)
- `native/` — C++ / iOS / Android / Windows SQLite + Nitro
- `examples/` — demo apps, each with its own `package.json`
- `dist/` and `nitrogen/` — generated; do not hand-edit (`yarn build`, `yarn specs`)

## Library (git root)

```bash
yarn              # install
yarn test         # Jest
yarn eslint && yarn typecheck
yarn build        # src/ → dist/
yarn specs        # regenerate Nitro codegen
```

Yarn 4.18. Node ≥ 22. Do not add `package-lock.json`.

## NotesApp (iOS / Android)

```bash
cd examples/NotesApp
yarn
yarn expo run:ios          # or: yarn expo run:android
```

Before starting Metro or `expo run:*`, check if the React Native dev server is already running (port **8081**). Check open terminals, or run `lsof -i :8081` / `curl -s http://localhost:8081/status`. If it is running, reuse it — do not start a second Metro.

Needs a development build (not Expo Go). After native/Nitro changes, rebuild. JS-only changes: reload Metro.

App id: `com.nitromelondb.example`

### Maestro e2e (from `examples/NotesApp`)

Install Maestro CLI, boot a simulator, then:

```bash
cd examples/NotesApp
maestro test maestro/
maestro test maestro/cold-start.yaml
```

Flows live in `examples/NotesApp/maestro/`.

### Maestro MCP

```bash
claude mcp add maestro -- maestro mcp
```

Or project config: `.mcp.json` / `.cursor/mcp.json` (`maestro mcp`). Use `list_devices`, `inspect_screen`, `cheat_sheet`, then `run`. Call `cheat_sheet` before writing new YAML.

## Conventions

- Tests for behavior changes: Jest under `src/**/__tests__`. Native SQLite/adapter work also needs `yarn test:ios` / `yarn test:android`.
- `yarn prettier` before commit. Changelog: `CHANGELOG-Unreleased.md`.
- No Paper/legacy bridge. No parallel `.d.ts` layer.
- Full setup and native troubleshooting: `CONTRIBUTING.md`.
