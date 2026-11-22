### Highlights

### BREAKING CHANGES

### Deprecations

### New features

- **Encryption build** (opt-in), the first step of database encryption (#60). Add `"nitromelondb": { "encryption": true }` to your app's `package.json` (or set `NITROMELONDB_ENCRYPTION=1`) and rebuild the native app: iOS, Android and Windows then compile [SQLite3 Multiple Ciphers](https://github.com/utelle/SQLite3MultipleCiphers) 2.7.1, which writes the SQLCipher 4 format (AES-256, HMAC-SHA512, PBKDF2). There is no passphrase API yet, so nothing is encrypted: databases stay plain SQLite files, and the build is there so apps can check size, setup and App Store export compliance ahead of time. Without the switch nothing changes, and apps contain no cryptography from NitromelonDB. That is why it is opt-in: Apple's export-compliance answer covers every library an app links. In the encryption build, iOS uses the bundled SQLite instead of the system one, with Apple's behavior-affecting options (WAL `synchronous=NORMAL`, FTS3/4/5, R*Tree, math functions, 500,000 bound variables), and SQLite's symbols are hidden, so it doesn't clash with expo-sqlite, op-sqlite, SQLCipher or the system SQLite. Size per arm64 slice: about +1.2 MB on iOS, +110 KB on Android. Passing `encryption` to the Expo config plugin fails with a pointer to `package.json`. New docs page: Advanced → Encryption, covering why it's opt-in, setup per platform, how to check it worked, and Apple's export-compliance table

### Fixes

### Performance

### Changes

### Internal

- Native SQLite is compiled through `native/shared/NitromelonSqlite.c` on every platform, with all options in `NitromelonSqliteConfig.h`, and native code includes `NitromelonSqlite.h` instead of `<sqlite3.h>`. `native/vendor/sqlite3mc` holds the sqlite3mc amalgamation (`scripts/vendor-sqlite3mc.mjs`, checked against the release's `SHA256SUMS`). The weekly bump workflow moves both vendored copies together, so the default and encryption builds are always on the same SQLite. `yarn test:native-unit` builds and tests both, checks they share a SQLite version, that the default build has no encryption, and that the encryption build encrypts (SQLCipher 4 defaults, wrong key fails, in-place encrypt, re-key and decrypt) and exports only `nitromelon_`-prefixed symbols
- Agent instructions: one `CLAUDE.md` per folder (each `AGENTS.md` is a symlink to it, for Codex and Cursor), replacing the duplicated `.claude/rules` and the per-prompt Claude Code hook. New guides for `examples/NotesApp_windows`, `native/windows`, `.github/workflows` and `examples/benchmark`.
