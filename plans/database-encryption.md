# Plan: Database encryption (SQLCipher) for NitromelonDB

Status: **proposal / not started**
Owner: TBD
Related upstream work: [Nozbe/WatermelonDB#1635](https://github.com/Nozbe/WatermelonDB/pull/1635) (open since 2023, never merged)

---

## 1. Goal

Ship at-rest encryption for the SQLite adapter on iOS, Android and Windows, with three
capabilities that the upstream PR explicitly does **not** have:

1. **Encrypt an existing plaintext database in place** (and the reverse: decrypt).
2. **Rotate the passphrase** on an already-encrypted database.
3. **Async passphrase resolution**, because in practice the key lives in the Keychain /
   Keystore behind `expo-secure-store`, biometrics, or a network call — all of which are
   asynchronous, while `new SQLiteAdapter(...)` is synchronous and usually runs at module
   scope.

Non-goals for this plan: encrypting the LokiJS/web adapter, field-level encryption,
key escrow / multi-device key exchange, encrypting the sync payloads in transit.

---

## 2. What we learned from the upstream PR

The PR itself is small (the bulk of its 264k added lines is a checked-in SQLCipher
amalgamation). What matters is the four-year comment thread, because every complaint in it
maps to a design requirement for us.

| Observed problem in the thread | Requirement it creates for us |
| --- | --- |
| Multiple users (`killerchip`, `rtripplanningbiz`, `nikitashmidt`) reported "I set the flag but the DB is not encrypted." The build flag (`$isEncryptedDB` in the Podfile / `ext { isEncryptedDB }` in Gradle) is opt-in, so if it doesn't take effect the `sqlite3_key` call is `#ifdef`-ed out and the passphrase is silently ignored — you get a plaintext database and no error. | **No silent failure.** Either compile the codec unconditionally, or hard-fail at runtime when a passphrase is supplied to a build without a codec. Plus a test that reads the raw file header and asserts it is *not* `SQLite format 3\0`. |
| `kmye` hit `redefinition of 'sqlite3_mem_methods'` because the app had another pod pulling in SQLite/SQLCipher headers. | **Don't depend on the `SQLCipher` pod.** Vendor the amalgamation, compile it into our own binary, include it via a quoted relative path, keep the header private, and test against an app that also has another SQLite pod. |
| `AlexanderDMitchell` asked how to use `expo-secure-store` given WatermelonDB is initialized at module scope. The answer from the PR author was essentially "I didn't need that." **Never addressed.** | **Async key provider + an init gate** in the adapter, so a `Promise<string>` key works with top-level construction. |
| The docs added by the PR say: *"you CAN NOT change the password of an existing database, you will need to create a new one, and you can not encrypt an existing DB as well."* | **The migration/transition engine is the main body of work here** — it is the thing that doesn't exist upstream. |
| `killerchip` proposed making this a separate adapter; the author argued (convincingly) that the adapter is the middle layer and the API is unchanged, so it should be a flag on `SQLiteAdapter`. `radex` never weighed in. | **Same `SQLiteAdapter`, new options.** No `EncryptedSQLiteAdapter`. |
| The PR pinned Android to `com.android.ndk.thirdparty:openssl:1.1.1l-beta-1` and used the SQLCipher CocoaPod on iOS. | Pick crypto providers deliberately per platform; 1.1.1 is long EOL. |
| PR was never merged, author eventually walked away, users forked. | Land it in phases, each independently mergeable and tested, so it can't rot. |

Also worth noting for our port: the upstream PR targets the *old* JSI bridge
(`nativeWatermelonCreateAdapter`) and the legacy `native/android-jsi` project. Neither
exists here — we go through Nitro (`native/nitro/HybridNitromelon*.cpp`,
`src/nitro/Nitromelon.nitro.ts`). So the diff is a reference for the SQLCipher mechanics
(`sqlite3_key`, build defines), not something we can cherry-pick.

---

## 3. Where the current code stands

Facts that constrain the design (verified in this repo):

- **iOS links the system `libsqlite3`** (`NitromelonDB.podspec:44`, `s.libraries = 'sqlite3'`);
  the vendored amalgamation in `native/vendor/sqlite/` (3.46.0) is compiled only on
  Android (`android/CMakeLists.txt:21`) and Windows (`native/windows/NitromelonDB/NitromelonDB.vcxproj`).
  The system SQLite has no codec, so iOS *must* switch to a compiled-in SQLCipher.
- **The database is opened lazily** in `HybridNitromelonDatabase::database()`
  (`native/nitro/HybridNitromelonDatabase.cpp:156`), on the first method that needs it —
  not in the constructor. This is very convenient: we can hand the key to the hybrid object
  after `createAdapter()` returns but before the file is ever touched.
- **All Nitro methods are currently synchronous** (`src/nitro/Nitromelon.nitro.ts`), running
  on the JS thread. Nitro does support `Promise<T>` returns backed by
  `Promise<T>::async(...)` on a background thread pool, which we need for the transition
  (encrypting a large DB will take seconds to minutes and must not block JS).
- **`SqliteDb::SqliteDb(std::string path)`** (`native/shared/Sqlite.cpp:20`) opens with
  `sqlite3_open_v2(..., READWRITE|CREATE|URI, nullptr)`. This is the single place a key
  needs to be applied, immediately after open and before any other statement.
- **Schema version lives in `pragma user_version`** (`native/shared/Database-sqlite.cpp:355`),
  read by `initialize()` before anything else. This is critical: `sqlcipher_export()` does
  **not** copy `user_version`, so a naive encrypt would make every app think it needs a
  fresh schema and reset the user's data. We must capture and restore it explicitly.
- **The adapter's init is fire-and-forget.** `SQLiteAdapter`'s constructor kicks off
  `_init()` and stores `_initPromise` (`src/adapters/sqlite/index.ts:108`), but nothing
  awaits it — not `Database`, not the example apps. There is no queue in front of
  `find`/`query`/`batch`; it works today only because the Nitro path is synchronous.
  An async key breaks that assumption, so an init gate is a prerequisite, not a nicety.
- **`Database.unsafeResetDatabase()`** (`src/Database/index.ts:354`) already has the
  "make the database unusable for a while" machinery: `_isBeingReset`, swapping
  `this.adapter` for an `ErrorAdapter` that throws on every call
  (`src/adapters/error.ts`), and `_workQueue._abortPendingWork()`. It's the right shape to
  generalize, except we want to *queue* rather than *abort*, since an encryption pass
  doesn't change any data.
- **`unsafeResetDatabase` on the native side** uses `SQLITE_DBCONFIG_RESET_DATABASE` +
  `VACUUM` rather than deleting files (`native/shared/Database.cpp:80`). That preserves the
  cipher key on the connection, so it should keep working unchanged — but it needs a test.
- **`deleteDatabaseFile` is declared but unimplemented on Android and a no-op on Windows**,
  and nothing deletes `-wal`/`-shm` sidecars anywhere. The transition needs real file
  operations on all three platforms, so this gap has to be closed.

---

## 4. Design

### 4.1 Build: compile SQLCipher on every platform, unconditionally

**Recommendation: replace the vendored SQLite amalgamation with the SQLCipher amalgamation
everywhere, always compiled in, no per-app build flag.**

SQLCipher is a fork of SQLite, not a layer on top; a build with the codec compiled in opens
and operates on ordinary plaintext databases identically when no key is set. So "always on"
costs us binary size and build time, and buys us the elimination of the entire class of bug
that dominates the upstream thread — a build flag that silently didn't apply.

Consequences to accept:

- iOS stops using the system `libsqlite3` and starts compiling ~9 MB of C. Expect a
  noticeable increase in clean-build time and roughly +1–1.5 MB of binary per architecture.
- We inherit SQLCipher's release cadence for SQLite version bumps rather than sqlite.org's.
- App Store export-compliance paperwork becomes relevant for consumers (see §8).

The alternative — keep the flag, opt-in — is cheaper for users who don't want encryption,
but it reintroduces the failure mode. If we do go that way, the runtime guard in §4.3 is
mandatory rather than merely a good idea. **This is decision D1 in §9.**

Crypto provider per platform (only one may be active per build):

| Platform | Provider | Define | Notes |
| --- | --- | --- | --- |
| iOS / tvOS | CommonCrypto | `SQLCIPHER_CRYPTO_CC` | Uses `CCCryptor`/`CCKeyDerivationPBKDF` + `SecRandomCopyBytes`. **No OpenSSL dependency**, hardware-accelerated, links `Security.framework`. This is a significant simplification over the upstream PR, which pulled the SQLCipher pod. |
| Android | OpenSSL | `SQLCIPHER_CRYPTO_OPENSSL` | Via the NDK prefab `com.android.ndk.thirdparty:openssl` (at a current version, not the PR's EOL 1.1.1l) or a vendored BoringSSL. Needs `buildFeatures { prefab true }` and `target_link_libraries(... crypto)`. |
| Windows | LibTomCrypt (vendored) or OpenSSL | `SQLCIPHER_CRYPTO_LIBTOMCRYPT` / `SQLCIPHER_CRYPTO_OPENSSL` | There is no system OpenSSL on Windows and no official CNG provider. LibTomCrypt is public-domain, dependency-free, and easy to vendor into the `.vcxproj`, at the cost of no AES-NI acceleration. **Decision D2.** Windows can also land in a later phase. |

Required build defines on all platforms (per the SQLCipher README):
`SQLITE_HAS_CODEC`, `SQLITE_TEMP_STORE=2`, `SQLITE_EXTRA_INIT=sqlcipher_extra_init`,
`SQLITE_EXTRA_SHUTDOWN=sqlcipher_extra_shutdown`, `SQLITE_THREADSAFE=1`. Note Android
currently passes *no* defines to `sqlite3.c`, which means it's building with
`SQLITE_THREADSAFE=0` — that needs fixing regardless of this feature.

Vendoring: SQLCipher does not publish a prebuilt amalgamation zip the way sqlite.org does;
it has to be generated from a git tag with `./configure && make sqlite3.c` (requires
`tclsh`). So `scripts/vendor-sqlite.mjs` gets a sibling, `scripts/vendor-sqlcipher.mjs`,
that clones a pinned tag, builds the amalgamation, and drops `sqlite3.c`/`sqlite3.h`/
`sqlite3ext.h` plus a `sqlcipher.version` and `LICENSE` into `native/vendor/sqlcipher/`.
Keep it a separate directory from `native/vendor/sqlite/` during the transition so we can
A/B and roll back.

### 4.2 Symbol-collision mitigation

`kmye`'s build failure is the thing most likely to generate issues after release. Concretely:

- Include the vendored header by quoted relative path from `native/shared`, never
  `#include <sqlite3.h>`, so we can't accidentally pick up a pod's or the SDK's header.
- Keep `sqlite3.h` out of `s.public_header_files` and out of any module map.
- Compile the amalgamation with `-fvisibility=hidden` so the symbols aren't exported from
  the dynamic framework.
- Add a CI job that builds an example app which *also* depends on a pod that vendors SQLite
  (e.g. `SQLCipher` or `sqlite3` pod) and assert it links.

Residual risk: in a fully static-linking configuration two copies of the SQLite symbols can
still collide at link time. Document it and provide an escape hatch (see D1 — an opt-out
build flag that reverts to the system/plain SQLite would double as the workaround).

### 4.3 Opening a keyed database

In `native/shared/Sqlite.cpp`, `SqliteDb` gains a key parameter. Immediately after
`sqlite3_open_v2` succeeds and before any other statement:

1. If a key is present, apply it with **`sqlite3_key_v2()`**, not `PRAGMA key = '...'`.
   Passing the key as SQL text means it can end up in error messages, trace callbacks and
   crash logs, and requires quote-escaping that is easy to get wrong.
2. Apply any non-default cipher settings (page size, KDF iterations, plaintext header size)
   *after* keying and *before* the first read — see D3.
3. Run the canary read: `SELECT count(*) FROM sqlite_master;`.
4. Interpret the outcome into a typed error rather than a raw SQLite message:
   - key supplied, canary fails ⇒ `WrongPassphraseError` (or corrupted file).
   - no key supplied, canary fails with "file is not a database" ⇒ `DatabaseIsEncryptedError`.
     This must **never** silently fall back to creating a fresh database.
5. **The no-silent-failure guard:** whenever a key is supplied, query `PRAGMA cipher_version`.
   An empty result means the binary has no codec — throw a loud, specific error naming the
   likely cause (stale native build, pod not reinstalled, opt-out flag set). This single
   check is what the upstream PR is missing and is the direct cause of most of its issue
   reports.
6. Best-effort zeroing of the key buffer after `sqlite3_key_v2` copies it
   (`explicit_bzero` / `SecureZeroMemory`), and no logging of the key anywhere.

### 4.4 The transition engine (encrypt / decrypt / rekey)

This is the core new capability. It runs against a **closed** database and produces a new
file, then swaps it in.

Paths, for `<db>` being the resolved database path:

```
<db>              the live database
<db>.transition   work-in-progress output
<db>.old          previous file, retained only during the swap
```

**Algorithm (encrypt; decrypt and rekey are the same with different keys):**

1. Run the crash-recovery routine (step 9) first.
2. Check free disk space ≥ 2× size of `<db>` (+ margin). Fail early with a clear error
   rather than filling the user's disk halfway through.
3. Delete any stale `<db>.transition`, `<db>.transition-wal`, `<db>.transition-shm`.
4. Open `<db>` with the *source* key (empty when encrypting a plaintext DB).
5. `PRAGMA wal_checkpoint(TRUNCATE);` so everything lives in the main file.
6. Read `PRAGMA user_version` into `v`. **Do not skip this.**
7. `ATTACH DATABASE '<db>.transition' AS transition KEY '<target key>';`
   (an empty key here produces a plaintext output — that's the decrypt path).
8. Apply any non-default cipher pragmas to `transition.*` *before* exporting.
9. `SELECT sqlcipher_export('transition');`
10. `PRAGMA transition.user_version = <v>;`
11. `DETACH DATABASE transition;` then close `<db>`.
12. **Verify before swapping.** Open `<db>.transition` with the target key and assert:
    `cipher_version` is as expected, `PRAGMA quick_check` returns `ok`,
    `user_version == v`, and a row-count spot check against the source matches. Close.
13. Swap: rename `<db>` → `<db>.old`; rename `<db>.transition` → `<db>`; **delete the old
    `<db>-wal` and `<db>-shm`** — they belong to the previous file and will corrupt the new
    one if left in place; then delete `<db>.old`.
14. Reopen `<db>` with the target key and continue with the normal `initialize()` flow.

**Crash recovery (step 1, runs on every startup before probing):**

- `<db>` exists and `<db>.transition` exists ⇒ the crash happened before the swap; `<db>` is
  still authoritative. Delete `<db>.transition` and its sidecars, then retry.
- `<db>` missing and `<db>.old` exists ⇒ the crash happened mid-swap. Rename `<db>.old` back
  to `<db>` (deleting a partial `<db>` if present) and retry.
- `<db>` exists and `<db>.old` exists ⇒ the crash happened after the swap but before
  cleanup. The new file is in place; just delete `<db>.old`.

Because the source file is never mutated until the verified rename, a kill at any point is
recoverable, which also means we don't need a foreground service on Android or
`beginBackgroundTask` on iOS to make this safe — only to make it *faster to finish*.

**Passphrase rotation** uses the same export-and-swap path rather than `PRAGMA rekey`.
`rekey` rewrites in place and is cheaper, but a crash mid-rekey has a much worse failure
mode. If we later want the fast path, expose it separately as
`unsafeFastRekey()` with the tradeoff documented.

**Threading.** The transition runs on a Nitro background thread via
`Promise<void>::async(...)`. Two cautions: resolve the database path on the JS thread first
(`platform::resolveDatabasePath` goes through JNI on Android, which needs a thread attach),
and assert that no `watermelondb::Database` instance is open for that path.

### 4.5 Why this is *not* a migration step (and how we give it migration ergonomics)

The instinct to model this as a migration is right about the ergonomics and wrong about the
mechanics:

- A `MigrationStep` is a SQL string executed inside a transaction on an already-open
  connection. Encryption is a whole-file operation that requires closing the connection and
  swapping files. It cannot be expressed as a step.
- Reading `pragma user_version` — the very thing that decides *which* migrations to run —
  requires the file to already be readable, i.e. correctly keyed. So the encryption
  transition has to happen strictly **before** `initialize()`, not inside the migration set.
- Schema version and encryption state are orthogonal. Apps will want to turn on encryption
  without bumping the schema, and bump the schema without touching encryption. Coupling them
  to one counter would force fake schema bumps.

So the ordering is fixed:

```
resolve key (async) → recover → probe on-disk state → transition if needed → initialize() → migrate
```

What we *do* borrow from migrations is the lifecycle surface, because that is the real
reason apps care: they need to know a long operation is running so they can hold the splash
screen. `SQLiteAdapterOptions` gets an `encryptionEvents` callback bag modelled on the
existing `migrationEvents` (`src/adapters/sqlite/type.ts:10`), with `onStart` / `onProgress`
/ `onSuccess` / `onError`. Progress is coarse — `sqlcipher_export` is a single statement, so
realistically we report phase transitions (`copying`, `verifying`, `swapping`) plus byte
counts, not a smooth percentage. A `sqlite3_progress_handler` on the export connection can
give a rough tick if we want a spinner that moves.

### 4.6 Async key resolution and the init gate

Two changes, both needed:

**(a) An init gate in `SQLiteAdapter`.** Every dispatcher-calling method routes through a
FIFO queue that drains once `_initPromise` settles. Today this is only survivable because
Nitro calls are synchronous and the Node dispatcher happens to queue internally
(`sqlite-node/DatabaseBridge.ts:203`); an async key makes it mandatory. If init *fails*, the
gate rejects everything with the init error rather than hanging forever — a database whose
passphrase couldn't be read must produce errors, not deadlock.

**(b) An explicit, intent-carrying encryption option.** The critical safety property: a
failed key read must never be interpreted as "the user wants a plaintext database." If
`SecureStore.getItemAsync` returns `null` because the keychain entry was wiped, and we treat
a missing key as "decrypt," we would silently strip encryption from the user's data. So
"no key" and "please decrypt" must be different inputs.

Sketch (exact naming is D4):

```ts
new SQLiteAdapter({
  schema,
  migrations,
  encryption: {
    // string | (() => Promise<string>) — resolved once, before the file is opened
    passphrase: async () => {
      const key = await SecureStore.getItemAsync('nitromelon-key')
      if (!key) throw new Error('Database key missing')   // -> init fails loudly
      return key
    },
  },
  encryptionEvents: {
    onStart: (op) => splash.show(op),      // 'encrypt' | 'decrypt' | 'rekey'
    onProgress: (p) => splash.update(p),
    onSuccess: () => splash.hide(),
    onError: (e) => reportAndOfferRecovery(e),
  },
})
```

Behaviour matrix, given the on-disk probe result:

| On disk | `encryption` option | Result |
| --- | --- | --- |
| missing | absent | create plaintext (today's behaviour) |
| missing | `{ passphrase }` | create encrypted |
| plaintext | absent | open plaintext |
| plaintext | `{ passphrase }` | **encrypt**, then open |
| encrypted | absent | **error** (`DatabaseIsEncryptedError`) — never auto-decrypt |
| encrypted | `{ passphrase }` matching | open |
| encrypted | `{ passphrase }` not matching | **error** (`WrongPassphraseError`) — never reset |
| encrypted | `{ decryptTo: 'plaintext', passphrase }` | **decrypt**, then open |

Explicitly refusing to reset on a wrong passphrase matters: the existing fallback path in
`_setUpWithMigrations` resets the database when it can't figure out a migration route
(`src/adapters/sqlite/index.ts:204`). A keying failure must be routed away from that path.

Rotation at runtime gets its own API rather than being inferred from an options change, so
that an app can't rotate by accident:

```ts
await changeDatabasePassphrase(database, newPassphrase)
```

This needs the pause-everything machinery: generalize `Database.unsafeResetDatabase`'s
approach (`_isBeingReset` + `ErrorAdapter` swap + work-queue handling) into a suspend
primitive that **queues** rather than aborts, since encryption doesn't change any data.
That is also why we don't need to clear `collection._cache` or notify observers afterwards —
record ids and contents are identical on the other side, so subscriptions stay valid.

### 4.7 Native API surface (Nitro spec)

Additions to `src/nitro/Nitromelon.nitro.ts` (then `yarn specs`):

```ts
export interface NitromelonEncryptionState {
  state: string            // 'missing' | 'plaintext' | 'encrypted' | 'wrong_key' | 'corrupt'
  cipherVersion?: string
  sizeBytes?: number
}

export interface NitromelonDatabase extends HybridObject<...> {
  // All three MUST be called before initialize(); native asserts the DB isn't open yet.
  setPassphrase(passphrase: string): void
  probeEncryption(passphrase: string): NitromelonEncryptionState
  recoverInterruptedTransition(): void
  transitionEncryption(fromPassphrase: string, toPassphrase: string): Promise<void>
  // ...existing methods
}
```

Putting these on `NitromelonDatabase` rather than the `Nitromelon` factory keeps
`createAdapter(dbName, usesExclusiveLocking)` unchanged and exploits the existing lazy open
in `HybridNitromelonDatabase::database()` — the key can arrive after construction because
the file hasn't been touched yet. `transitionEncryption` is the only async one, since it's
the only one that can take minutes.

New C++ lives in `native/shared/` (e.g. `DatabaseEncryption.cpp/.h`) so iOS, Android and
Windows share it. Platform work needed: implement `deleteDatabaseFile` on Android (currently
an empty body) and Windows (currently a no-op), and add rename/exists/free-space helpers to
`DatabasePlatform.h`.

### 4.8 Node and web adapters

- **Node** (`src/adapters/sqlite/sqlite-node/`) uses `better-sqlite3`, which has no codec.
  Recommendation: add optional support via `better-sqlite3-multiple-ciphers` (a drop-in fork
  with SQLite3MultipleCiphers, which supports SQLCipher-compatible mode and implements
  `sqlcipher_export()`). This matters disproportionately: it's what lets the whole transition
  state machine be tested in Jest instead of only on device. **Verify the `sqlcipher_export`
  and `PRAGMA cipher_*` surface is compatible before committing to it (task in Phase 0).**
  If it isn't, fall back to a hand-rolled export in JS for tests only.
- **Web / LokiJS**: out of scope. Passing `encryption` to `LokiJSAdapter` must throw a clear
  "not supported on web" error rather than being ignored.

---

## 5. Phases

Each phase should be independently mergeable, with tests, a `CHANGELOG-Unreleased.md` entry,
and green `yarn ci:check`.

### Phase 0 — Spike and decisions (no shipping code)

- [ ] Build the SQLCipher amalgamation from a pinned tag; measure binary size and clean-build
      time delta on iOS and Android against the current vendored SQLite.
- [ ] Confirm `SQLCIPHER_CRYPTO_CC` builds and passes SQLCipher's own tests on iOS.
- [ ] Evaluate Android OpenSSL sourcing (NDK prefab version currently available vs. vendored
      BoringSSL) and Windows LibTomCrypt vs. OpenSSL.
- [ ] Verify `better-sqlite3-multiple-ciphers` supports `sqlcipher_export()` and
      SQLCipher-compatible page format well enough for tests.
- [ ] Confirm SQLCipher Community Edition's BSD-style license terms and the attribution we
      need to carry.
- [ ] Resolve D1–D5 in §9.

### Phase 1 — SQLCipher in the build, no JS API

- [ ] `scripts/vendor-sqlcipher.mjs` + `native/vendor/sqlcipher/` + `sqlcipher.version`.
- [ ] iOS: podspec compiles the amalgamation, drops `s.libraries = 'sqlite3'`, adds
      `Security.framework` and the codec defines; header kept private, `-fvisibility=hidden`.
- [ ] Android: `android/CMakeLists.txt` points at the SQLCipher sources, adds the required
      defines (including the missing `SQLITE_THREADSAFE=1`), links OpenSSL.
- [ ] Windows: `.vcxproj` sources/defines, crypto provider per D2.
- [ ] Runtime assertion at open: if a key is ever supplied, `PRAGMA cipher_version` must be
      non-empty (§4.3 step 5).
- [ ] Existing test suites (`yarn test`, `yarn test:ios`, `yarn test:android`) pass unchanged
      against plaintext databases.
- [ ] CI: the "another SQLite pod is present" link test from §4.2.

### Phase 2 — Open with a key

- [ ] Nitro spec: `setPassphrase`, `probeEncryption`; regenerate with `yarn specs`.
- [ ] `SqliteDb` keying via `sqlite3_key_v2`, canary read, typed errors, key zeroing.
- [ ] `SQLiteAdapterOptions.encryption` (create-encrypted and open-encrypted paths only —
      no transitions yet); reject the option on `LokiJSAdapter`.
- [ ] Async passphrase provider + the init gate (§4.6a), including the "init failed ⇒ reject
      queued work" behaviour.
- [ ] Tests: create encrypted, reopen, wrong key errors, missing key on an encrypted file
      errors, and the raw-file-header assertion that the bytes are not `SQLite format 3\0`.

### Phase 3 — The transition engine

- [ ] `native/shared/DatabaseEncryption.{h,cpp}`: probe, encrypt, decrypt, rekey, verify,
      crash recovery.
- [ ] Platform file helpers: implement `deleteDatabaseFile` on Android and Windows; add
      rename / exists / free-space; handle `-wal`/`-shm` sidecars.
- [ ] Nitro `transitionEncryption(): Promise<void>` on a background thread, with the
      path-resolution-on-JS-thread caveat.
- [ ] Adapter wiring: probe → transition → `initialize()` ordering, `encryptionEvents`.
- [ ] Tests, including deliberately interrupting between every step and asserting recovery,
      `user_version` preservation, and a wrong-key transition attempt leaving the source
      untouched.

### Phase 4 — Runtime rotation and app-facing ergonomics

- [ ] Generalize the `unsafeResetDatabase` suspend machinery into a queueing suspend
      primitive on `Database`.
- [ ] `changeDatabasePassphrase(database, newPassphrase)`.
- [ ] Decrypt-back path exposed in options (`decryptTo: 'plaintext'`).
- [ ] React ergonomics: a way for `DatabaseProvider` consumers to render a splash/progress
      state while init, transition, or migration is in flight.

### Phase 5 — Docs, examples, hardening

- [ ] `docs-website/docs/docs/Advanced/Encryption.md` — setup, key management guidance,
      the transition lifecycle, threat model and its limits, export compliance.
- [ ] Update `Installation.mdx`, `Setup.md`, `Advanced/Migrations.md` (ordering vs. migrations),
      `Implementation/DatabaseAdapters.md`.
- [ ] `examples/NotesApp`: an encrypted variant using `expo-secure-store`, demonstrating
      first-run encryption of an existing plaintext DB with a progress UI.
- [ ] `examples/benchmark`: encrypted vs. plaintext throughput, and transition duration on a
      1M-row database.
- [ ] Security review pass: no key in logs, crash reports, or error messages; key zeroing;
      documented residual risks.

---

## 6. Testing

| Layer | What |
| --- | --- |
| Jest (`src/adapters/sqlite/test.js`, `commonTests.js`) | Full matrix from §4.6 against the Node ciphers build; transition round-trips; interrupted-transition recovery via injected failure hooks; `user_version` preservation across encrypt/decrypt. |
| Raw-file assertion | After encryption, read the first 16 bytes of the file and assert they are not `SQLite format 3\0`. This is the single test that would have caught every "it's not actually encrypted" report on the upstream PR — it belongs in both the Jest and the native suites. |
| Native (`src/adapters/sqlite/integrationTest.js`, run by `yarn test:ios` / `yarn test:android`) | Real filesystem: sidecar handling, atomic swap, large-database transition, `unsafeResetDatabase` on a keyed connection, headless/background access. |
| Windows (`yarn test:windows`) | Same, once Phase 1 lands there. |
| Link tests in CI | App with a competing SQLite/SQLCipher pod builds and links (§4.2). |
| Benchmarks | Regression guard on plaintext throughput after switching to the SQLCipher build — this must not silently slow down users who don't use encryption. |

---

## 7. Threat model — be explicit in the docs about what this does not do

Encryption at rest protects the database file when the device is off or the file is
exfiltrated. It does not protect against:

- A key that is reachable by the same code an attacker has already compromised. On a rooted
  or jailbroken device, or with a debugger attached, the key is in the process's memory.
- Plaintext remnants. After encrypting an existing database, the old plaintext pages may
  survive on flash even after the file is deleted — filesystem-level secure erase is not
  something we can guarantee. Say so plainly.
- Temporary files and the WAL, which are keyed by SQLCipher, but also `SQLITE_TEMP_STORE=2`
  keeps temp material in memory — worth stating that this is deliberate.
- iOS Data Protection interactions: if the key is stored with `kSecAttrAccessibleWhenUnlocked`,
  background tasks and headless JS will fail to open the database while the device is locked.
  `...AfterFirstUnlock` is the usual compromise; document the tradeoff rather than choosing
  for the user.
- Backups: on iOS the default database location under `Documents` is backed up to iCloud.
  Both the encrypted database and any transient `<db>.old` plaintext copy would be included —
  set the do-not-backup attribute on transition artifacts, and mention the backup question.

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Data loss during an interrupted transition | Source file is never mutated until a verified rename; idempotent recovery routine; tests that interrupt at every step. |
| Silent non-encryption (the upstream PR's defining failure) | Unconditional codec build + `cipher_version` runtime guard + raw-header test. |
| Silent *decryption* from a failed async key read | "No key" and "decrypt" are distinct inputs; missing key is an error, never an implicit decrypt. |
| Data reset from a wrong passphrase | Keying failures are routed away from the `_setUpWithMigrations` reset fallback. |
| `user_version` lost by `sqlcipher_export` ⇒ every app thinks it needs a fresh schema | Explicitly captured and restored; asserted in verification and in tests. |
| Symbol collisions with other pods | §4.2, plus a CI link test. |
| Perf regression for non-encryption users | Benchmark gate in CI; SQLCipher without a key should be within noise of plain SQLite. |
| Binary size / build time increase for everyone | Measured in Phase 0; feeds decision D1. |
| App Store export compliance surprises consumers | Documented: `ITSAppUsesNonExemptEncryption`, the usual exemption for standard cryptography, and the French declaration question. |
| Windows lagging | Explicitly allowed to land a phase behind; feature must fail loudly rather than silently on unsupported builds. |

---

## 9. Decisions needed before Phase 1

- **D1.** Compile SQLCipher unconditionally on all platforms (recommended), or keep an
  opt-out/opt-in build flag? Depends on the Phase 0 size and build-time measurements. Note
  that an opt-out flag also doubles as the escape hatch for symbol collisions.
- **D2.** Windows crypto provider: vendored LibTomCrypt (no dependencies, slower) vs. OpenSSL
  via vcpkg (faster, heavier build)? And does Windows ship with Phase 1 or a phase later?
- **D3.** Cipher parameters: accept SQLCipher 4 defaults (AES-256-CBC, 256k PBKDF2-HMAC-SHA512
  iterations, 4096-byte pages), or expose them and/or lower the KDF cost for launch latency
  on low-end Android? Defaults are the safe answer; exposing them creates a
  forever-compatibility surface. Related: do we support `cipher_plaintext_header_size` for
  apps that need the file to be recognizable?
- **D4.** Public API naming: `encryption: { passphrase }` on `SQLiteAdapterOptions` versus a
  flatter `passphrase` (which is what the upstream PR used). The nested form leaves room for
  `decryptTo`, cipher params and rotation without another breaking change.
- **D5.** Raw 32-byte key support (`PRAGMA key = "x'...'"`) in addition to passphrases, for
  apps that derive keys themselves and don't want to pay PBKDF2 on every launch. Cheap to
  add in Phase 2, awkward to bolt on later.

---

## 10. Open questions

- Should `Database` expose a first-class "not ready yet" state so apps stop having to know
  about `adapter.initializingPromise`? The init gate makes it work without awaiting, but a
  multi-minute encryption pass really does want a UI, and today there's no idiomatic place
  to hang one.
- Do we want a `dryRun` / `estimate` API so an app can tell the user "this will take about a
  minute and needs 200 MB free" before committing?
- Is there a use case for encrypting only on first login (key derived from the user's
  credentials) rather than at first launch? That's the runtime-rotation machinery from
  Phase 4 applied to the enable case, and it may deserve a documented recipe.
