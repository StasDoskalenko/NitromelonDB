---
paths:
  - "examples/NotesApp/maestro/**"
---

# Maestro e2e

Always run from `examples/NotesApp`:

```bash
cd examples/NotesApp
maestro test maestro/
maestro test maestro/cold-start.yaml
```

App id in every flow: `com.nitromelondb.example`

MCP (preferred if connected):

1. `list_devices`
2. `inspect_screen` before tapping
3. `cheat_sheet` before writing new YAML
4. `run` with `{ files }` or `{ yaml }`

Do not run Maestro from the library root. Do not use Maestro Cloud unless asked.
