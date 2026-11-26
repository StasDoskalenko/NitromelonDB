---
title: 'How it works'
sidebar_label: 'How it works'
hide_title: true
description: 'What the encryption build changes (engine, iOS SQLite settings, file format, SQLCipher interoperability, secure_delete) and how encryption is tested.'
---

# How it works

## What changes in the encryption build

**The engine.** The encryption build compiles [SQLite3 Multiple Ciphers](https://github.com/utelle/SQLite3MultipleCiphers) (sqlite3mc, MIT licensed) on every platform. It is unmodified SQLite plus an encryption layer, and NitromelonDB's copy is always built on the same SQLite version as the default build (3.54.1 today), so switching between the two never changes how your SQL behaves on Android and Windows.

**On iOS** it replaces the system SQLite. To keep behavior the same, it is built with the settings of Apple's SQLite that an app can notice:

- WAL commits without `fsync` (`synchronous = NORMAL`), and a full sync at checkpoints, so writes are as fast as before,
- full-text search (FTS3, FTS4, FTS5), R*Tree and math functions, for anyone using them through `Q.unsafeSqlQuery`,
- up to 500,000 bound variables per statement.

**Your existing databases.** With no key set, the encryption build reads and writes ordinary SQLite files, byte for byte the same as before. Turning the switch on doesn't touch a single database, and turning it off again is safe for as long as none of your databases has been encrypted.

**The format.** Encrypted databases use the SQLCipher 4 format with its defaults: AES-256-CBC, HMAC-SHA512 page authentication, and keys derived with PBKDF2-HMAC-SHA512 over 256,000 iterations. Only this one cipher is compiled in. Any SQLCipher 4 tool can open these files with the key, which helps when you debug: the `sqlcipher` command-line shell, or [DB Browser for SQLite](https://sqlitebrowser.org/) with SQLCipher support. Our tests open a database written by SQLCipher 4 itself (the one SQLCipher's own compatibility test uses), on device builds and on Node.

**Databases from another SQLCipher library.** For the same reason, a database that another library encrypted with SQLCipher 4's default settings (Room with SQLCipher for Android, `expo-sqlite` with `useSQLCipher`, `op-sqlite` with `sqlcipher`) opens with the same passphrase: pass it as `encryption.passphrase`. A database with changed settings (a raw key, other `kdf_iter`, `cipher_compatibility` 3) doesn't, and fails with `encryption_key_invalid` without being changed.

**Deleted data is zeroed.** In an encrypted database, NitromelonDB turns on SQLite's `secure_delete`, as SQLCipher does by default: content you delete is overwritten instead of staying, still encrypted, in the file's free pages. Deletes write a little more. Plain databases are set up as before.

**Other SQLite libraries in your app.** The encryption build hides all of its SQLite symbols. An app can also contain `expo-sqlite`, `op-sqlite`, the SQLCipher pod or the system SQLite without duplicate-symbol errors, and without one library quietly running on another's SQLite. One rule: two SQLite libraries in one app must not open the **same database file**, because they don't share file locks.

## What we test

- **Native, on every CI run, both builds:** opening with the right, wrong and missing passphrase, plain databases with and without `ifUnencrypted`, encrypting, changing the passphrase and decrypting from WAL mode, the progress each of them reports (polled from another thread: it only moves forward, within 0 to 1, and passes through the middle), `unsafeResetDatabase()` on an encrypted database (it stays encrypted with the same passphrase), all three refusing to run while another connection has the file open, and two kinds of interruption: killing the process at points throughout each of them on a 10 MB database, and crashing it exactly at the two moments of the commit where a database is most at risk (right after the first page is rewritten, and right before the journal is deleted). Each time, the database opens, complete, with the old or the new passphrase. A database written by SQLCipher 4 itself opens, with every row. The default build must refuse a passphrase.
- **JavaScript (Jest):** passphrase functions (including ones that fail), the order of calls made before the passphrase arrives and during a re-key, events (including progress and extra listeners), the `useEncryption` hook, error codes, and that keying errors never lead to a reset. On Node, against real encrypted files: creating, opening with the right, wrong and missing passphrase (the file unchanged), encrypting, re-keying and decrypting through `Database`, `unsafeResetDatabase()`, refusing a re-key while another connection is open, and opening a database the native build encrypted (and the native test opens one Node encrypted).
- **On a device (iOS simulator, Android emulator and Windows, CI):** the whole upgrade, with real builds. The plain build of our example app creates a database; the encryption build is installed over it, opens it, and encrypts it; the test then reads the file from the app's data folder to check it has no SQLite header and that a note's text can't be found in any database file; a cold start opens it with the passphrase; the plain build, installed over it, fails with `encryption_key_required` and leaves the file byte for byte unchanged; the encryption build opens it again with every note; decrypting turns it back into a plain SQLite file with every note, leaving no copy behind; the plain build, installed over it, opens it; and on iOS and Android, the encryption build encrypts it again, empties it, and makes its first sync a [Turbo Login](../Sync/Frontend.md#advanced-adopting-turbo-login), which writes the server's records straight into the encrypted file.
- **By hand on Windows:** when another process holds the database file open, decrypting fails with `rekey_failed` and leaves the database encrypted with the same passphrase.
