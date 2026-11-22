### Highlights

### BREAKING CHANGES

### Deprecations

### New features

- **Database encryption** (opt-in, iOS, Android and Windows, #60), in the SQLCipher 4 format (AES-256, HMAC-SHA512, PBKDF2):
  - **The encryption build.** Add `"nitromelondb": { "encryption": true }` to your app's `package.json` (or set `NITROMELONDB_ENCRYPTION=1`) and rebuild the native app: iOS, Android and Windows then compile [SQLite3 Multiple Ciphers](https://github.com/utelle/SQLite3MultipleCiphers) 2.7.1. Without the switch nothing changes, and apps contain no cryptography from NitromelonDB. That is why it is opt-in: Apple's export-compliance answer covers every library an app links. In the encryption build, iOS uses the bundled SQLite instead of the system one, with Apple's behavior-affecting options (WAL `synchronous=NORMAL`, FTS3/4/5, R*Tree, math functions, 500,000 bound variables), and SQLite's symbols are hidden, so it doesn't clash with expo-sqlite, op-sqlite, SQLCipher or the system SQLite. Size per arm64 slice: about +1.2 MB on iOS, +110 KB on Android. Passing `encryption` to the Expo config plugin fails with a pointer to `package.json`.
  - **The passphrase.** `new SQLiteAdapter({ encryption: { passphrase } })` opens or creates an encrypted database. The passphrase can be a function (Keychain, biometric prompt, server): every database call waits for it. An empty passphrase, a wrong or missing one, or a plain database where an encrypted one was expected fails setup with `error.code` (`encryption_key_invalid`, `encryption_key_required`, `database_not_encrypted`) and never changes or resets the file. A passphrase given to a build without the switch throws `encryption_unavailable` naming the fix, instead of writing a plaintext database. LokiJS, web and Node refuse the option.
  - **Existing users.** With `ifUnencrypted: 'open'`, a plain database from an earlier app version opens as it is, and `database.unsafe_EncryptDB(passphrase)` (in a writer) encrypts it in place, keeping every record. The same call changes the passphrase of an encrypted database, and `database.unsafe_DecryptDB()` decrypts (by writing a decrypted copy and replacing the file with it, so it needs free space for the copy). Reads made meanwhile wait, the JS thread doesn't block, and `encryption.events` (`onStart` with the size, `onSuccess`, `onError`) report it. Killing the app in the middle leaves the database either as it was or fully re-keyed, never damaged: the next launch rolls back an interrupted encryption before opening the file. Also `database.isDBEncrypted()`, `SQLiteAdapter.isEncryptionAvailable()` and `SQLiteAdapter.getDatabaseEncryptionState(dbName)` (reads the file header only).
  - New docs page, Advanced → Encryption: why it's opt-in, setup per platform, keeping the passphrase in the Keychain/Keystore, migrating existing users, error codes, and Apple's export-compliance table

### Fixes

- Native: errors from opening a database (e.g. a full disk) were thrown as pointers, which nothing could catch as an error; and `SqliteDb` and `Database` left their "already closed" flags uninitialized

### Performance

### Changes

### Internal

- Native SQLite is compiled through `native/shared/NitromelonSqlite.c` on every platform, with all options in `NitromelonSqliteConfig.h`, and native code includes `NitromelonSqlite.h` instead of `<sqlite3.h>`. `native/vendor/sqlite3mc` holds the sqlite3mc amalgamation (`scripts/vendor-sqlite3mc.mjs`, checked against the release's `SHA256SUMS`). The weekly bump workflow moves both vendored copies together, so the default and encryption builds are always on the same SQLite. `yarn test:native-unit` builds and tests both, checks they share a SQLite version, that the default build has no encryption, and that the encryption build encrypts (SQLCipher 4 defaults, wrong key fails, in-place encrypt, re-key and decrypt) and exports only `nitromelon_`-prefixed symbols
- Encryption: the native open and re-key logic is in `native/shared/SqliteEncryption.cpp`, tested by `yarn test:native-unit` in both builds, including killing a process in the middle of encrypting, re-keying and decrypting. New CI jobs build NotesApp for iOS and Android with the encryption build next to the plain one, then, on a simulator and an emulator, install the plain build, upgrade it to the encryption build, encrypt the database, and check the file in the app's data folder between steps (`scripts/ci-notesapp-encryption-upgrade.sh`, flows in `examples/NotesApp/maestro-encryption`). NotesApp shows the encryption state and an Encrypt button in the encryption build, and a setup error screen instead of loading forever. The Nitro adapter's `setStoreWholeNumbersAsIntegers` no longer opens the database, so opening errors come from `initialize`
- Agent instructions: one `CLAUDE.md` per folder (each `AGENTS.md` is a symlink to it, for Codex and Cursor), replacing the duplicated `.claude/rules` and the per-prompt Claude Code hook. New guides for `examples/NotesApp_windows`, `native/windows`, `.github/workflows` and `examples/benchmark`.
