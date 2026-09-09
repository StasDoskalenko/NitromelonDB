# wa-sqlite binary provenance

The Emscripten artifacts in this directory come from rhashimoto/wa-sqlite tag `v1.1.2` (commit `2bf1c59d89eb6497535a4217bc62fec68a0bb994`).
The runtime JavaScript dependency in `package.json` is pinned to that same
immutable commit.

| File | SHA-256 |
| --- | --- |
| `wa-sqlite-async.wasm` | `6bfcf02fe6c30eb05784850d985f37058475fce686cdcdc4322c8192c5a43722` |
| `wa-sqlite-async.mjs` (patched) | `affb8f789c6d81bd1770b3b2b5b41baae71b35b316a8196292739ab8d1719bb4` |
| upstream `dist/wa-sqlite-async.mjs` | `4ac8be5305557ac06f08b70beae24b4e55ba21993b608c49b3531db1cf981a01` |

The JavaScript glue has one deliberate source patch: its `_scriptName` base is
`self.location.href` instead of `import.meta.url`. Expo Metro currently rewrites
`import.meta` in the emitted worker chunk. This adapter is worker-only and also
supplies `wasmBinary` and `locateFile`, so the worker URL is the correct safe base.

Regenerate both artifacts and this file with:

```
node scripts/vendor-wa-sqlite.mjs <commit-sha>
```

CI runs `node scripts/vendor-wa-sqlite.mjs --verify` on every push to confirm the
committed artifacts still equal upstream plus exactly that one patch, and that this
file's hashes match. When bumping to a new commit, also update the pinned commit in
`package.json`'s `wa-sqlite` dependency (`.yarnrc.yml`'s `approvedGitRepositories`
entry for rhashimoto/wa-sqlite does not need to change), then run the Chromium suite
(`yarn --cwd examples/NotesApp test:web`).
