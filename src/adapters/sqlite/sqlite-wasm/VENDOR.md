# wa-sqlite provenance

Everything NitromelonDB's web adapter loads from wa-sqlite is vendored here from
rhashimoto/wa-sqlite tag `v1.1.2` (commit `2bf1c59d89eb6497535a4217bc62fec68a0bb994`). wa-sqlite is MIT licensed (see
`vendor/wa-sqlite/LICENSE`). NitromelonDB does not depend on the `wa-sqlite`
package, so installs never download the upstream repository.

| File | SHA-256 |
| --- | --- |
| `wa-sqlite-async.wasm` | `6bfcf02fe6c30eb05784850d985f37058475fce686cdcdc4322c8192c5a43722` |
| `wa-sqlite-async.mjs` (patched) | `affb8f789c6d81bd1770b3b2b5b41baae71b35b316a8196292739ab8d1719bb4` |
| upstream `dist/wa-sqlite-async.mjs` | `4ac8be5305557ac06f08b70beae24b4e55ba21993b608c49b3531db1cf981a01` |
| `vendor/wa-sqlite/LICENSE` | `547f9e97e461bd369cc64b6fc12d724e8b02764b8db7812691f29f0ec572be79` |
| `vendor/wa-sqlite/sqlite-api.js` | `6a18bc86fa5a2ef300c7a7a84bfc762caff396ec56af17fcc4885d20189fe54c` |
| `vendor/wa-sqlite/sqlite-constants.js` | `f7b570f0c39e4b54c99f2598b6ad42018d4d8bf791861ede20d295628ae49f8f` |
| `vendor/wa-sqlite/VFS.js` | `55e7455e2ec0000cc4ba7a8bf7882f414a40f2a0ba6eb4c4ac847f379f54d92f` |
| `vendor/wa-sqlite/FacadeVFS.js` | `6de41eee28f7d4279d409e275b3e25fd5e7837163386e4e8f2c379cd9f72a60c` |
| `vendor/wa-sqlite/WebLocksMixin.js` | `0ee2f39f43b3a8d70e94c0e5a2bac97f2c55416830183d4810caf28b2cec7375` |
| `vendor/wa-sqlite/examples/IDBBatchAtomicVFS.js` | `809018e8976a8001bfac6062b1faa2a75333bd004885c8918f926c9e596e9cc6` |

`vendor/wa-sqlite/` holds upstream's JavaScript API (`sqlite-api.js`) and the
IndexedDB VFS (`examples/IDBBatchAtomicVFS.js`) with its imports, byte for byte
and in upstream's relative layout. Not part of the upstream snapshot: the `.d.ts`
files (NitromelonDB's own minimal typings) and `package.json`, which only sets
`"type": "module"` as upstream's own package.json does.
The build copies `vendor/` as-is instead of running it through Babel.

The Emscripten JavaScript glue has one deliberate source patch: its `_scriptName`
base is `self.location.href` instead of `import.meta.url`. Expo Metro currently
rewrites `import.meta` in the emitted worker chunk. This adapter is worker-only
and also supplies `wasmBinary` and `locateFile`, so the worker URL is the correct
safe base.

Regenerate every file above and this file with:

```
node scripts/vendor-wa-sqlite.mjs <commit-sha> [tag]
```

CI runs `node scripts/vendor-wa-sqlite.mjs --verify` on every push to confirm the
committed files still equal upstream (plus exactly that one `.mjs` patch) and that
this file's hashes match. After bumping, run the Chromium suite
(`yarn --cwd examples/NotesApp test:web`).
