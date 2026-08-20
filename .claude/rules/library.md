---
paths:
  - "src/**"
  - "native/**"
---

# Library code

You are in the published library (`src/` JS/TS, `native/` SQLite/Nitro).

```bash
yarn test
yarn eslint
yarn typecheck
yarn build
```

The example app is `examples/NotesApp`. Do not put app UI or Maestro flows here.
Do not hand-edit `dist/` or `nitrogen/`. After Nitro spec changes: `yarn specs`.
