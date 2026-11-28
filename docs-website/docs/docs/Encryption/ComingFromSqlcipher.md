---
title: 'Coming from SQLCipher'
sidebar_label: 'Coming from SQLCipher'
hide_title: true
description: 'Your app already encrypts its database with SQLCipher (a patched WatermelonDB, Room, expo-sqlite, op-sqlite): which databases NitromelonDB opens as they are, and how to migrate the ones it does not (SQLCipher 3, custom settings).'
---

# Coming from SQLCipher

If your app already encrypts its database with SQLCipher, for example with a patched or forked WatermelonDB, most databases open in NitromelonDB as they are: [turn on the encryption build](./Setup.md) and pass the same passphrase as `encryption.passphrase`. This page tells you whether yours is one of them, and how to migrate it if it isn't.

## Will it open?

NitromelonDB reads and writes [SQLCipher 4's format with its default settings](./HowItWorks.md#what-changes-in-the-encryption-build). It doesn't take other SQLCipher settings, so:

| Your database                                                                                                                                                                                                                     | Opens in NitromelonDB?                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| SQLCipher 4 (2018 or later) with its default settings: the app only sets the key. That's the case for the WatermelonDB SQLCipher patch ([Nozbe/WatermelonDB#1635](https://github.com/Nozbe/WatermelonDB/pull/1635)) and its forks | **Yes**, with the same passphrase                                                  |
| The same, from another library with default settings: Room with SQLCipher for Android 4.x, `expo-sqlite` with `useSQLCipher`, `op-sqlite` with `sqlcipher`                                                                        | **Yes**, with the same passphrase                                                  |
| A raw key: the key is `x'` followed by 64 hex digits and `'` (or 96 digits: the key, then the salt)                                                                                                                               | **Yes**: pass the same string as `encryption.passphrase` ([below](#a-raw-key))     |
| SQLCipher 1, 2 or 3 settings: an older SQLCipher library, or a newer one with `PRAGMA cipher_compatibility = 3` or the SQLCipher 3 settings set by hand                                                                           | **No**: [migrate it with `cipher_migrate`](#sqlcipher-1-2-or-3)                    |
| Settings your app changed: `kdf_iter`, `cipher_page_size`, `cipher_hmac_algorithm`, `cipher_kdf_algorithm`, `cipher_default_*`                                                                                                    | **No**: [migrate it with `sqlcipher_export`](#changed-settings)                    |
| A plaintext header (`cipher_plaintext_header_size`), with the salt kept by your app                                                                                                                                               | Possibly: [see below](#a-plaintext-header)                                         |
| Encrypted by something other than SQLCipher: SQLite's SEE, wxSQLite3, or SQLite3 Multiple Ciphers with its default cipher (ChaCha20)                                                                                              | **No**: decrypt it with that library, or export it in SQLCipher 4's default format |

A database that doesn't open fails setup with `encryption_key_invalid`, as a wrong passphrase does. NitromelonDB leaves the file as it was, so it's safe to try. If you aren't sure which settings your app used, try opening a copy of a real database in [DB Browser for SQLite](https://sqlitebrowser.org/) with the passphrase and "SQLCipher 4 defaults". If it opens there, it opens in NitromelonDB.

### A raw key

SQLCipher [treats a key written as `x'…'`](https://www.zetetic.net/sqlcipher/sqlcipher-api/#key) as the key itself, without deriving it from a passphrase: 64 hex digits are the 32-byte key, and 96 are the key followed by the 16-byte salt. NitromelonDB does the same with `encryption.passphrase`, on every platform, so pass the same string your app passed to `PRAGMA key` or `sqlite3_key()`:

```js
encryption: {
  passphrase: async () => `x'${await loadKeyHex()}'`
}
```

A raw key skips the key derivation (PBKDF2, 256,000 iterations), so opening is faster: see [What it costs](./HowItWorks.md#what-it-costs). In exchange, the key must be 32 random bytes, which only a key generator gives, never a password.

### A plaintext header

NitromelonDB's [`plaintextHeader`](./MultipleConnections.md#ios-app-groups-a-plaintext-header) uses SQLCipher's layout with a 32-byte plaintext header, and keeps the salt in a file named `<database file>-nitromelon-salt` next to the database: the salt as 32 hex digits, nothing else. If your app used `cipher_plaintext_header_size = 32`, write the salt your app kept into that file before NitromelonDB opens the database, and pass `plaintextHeader: true`. We haven't tested this with a database written by SQLCipher itself, so try it on copies of real databases first. Another header size doesn't open.

## Migrating a database that doesn't open

NitromelonDB can't read these databases, so the conversion happens in your app's **current** library, before you move to NitromelonDB:

1. **Release one more version of your app, still on your current library,** that converts the database to SQLCipher 4's default settings at launch, as shown below. The passphrase stays the same.
2. **Move to NitromelonDB in a later version,** once most of your users have opened the converting version (check your analytics).

The conversion needs SQLCipher 4.0 or later. If your app is still on SQLCipher 3, update the library in that same version: SQLCipher 4 can't open your database with its defaults, but `cipher_migrate` converts it.

### SQLCipher 1, 2 or 3

[`PRAGMA cipher_migrate`](https://www.zetetic.net/sqlcipher/sqlcipher-api/#cipher_migrate) converts a database that uses SQLCipher 1, 2 or 3's default settings to SQLCipher 4's, in place, keeping every record. Run it after setting the key. It returns a single row with `0` when it worked; anything else means the key is wrong, or the database used settings that weren't the defaults (then [use `sqlcipher_export`](#changed-settings)).

```sql
PRAGMA key = 'your passphrase';
PRAGMA cipher_migrate;
```

SQLCipher recommends not running it on every launch: open and key the database as usual, run a query, and only if that fails, open it again and run `cipher_migrate`. The connection must be opened with permission to create files (`SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE`).

### Changed settings

[`sqlcipher_export()`](https://www.zetetic.net/sqlcipher/sqlcipher-api/#sqlcipher_export) copies a database into an attached one. The attached database gets SQLCipher 4's default settings, while the settings you set on the old database apply only to it. So set them as your app does today, then attach and export:

```sql
PRAGMA key = 'your passphrase';
PRAGMA kdf_iter = 64000;            -- whichever settings your app sets today
PRAGMA cipher_page_size = 1024;
ATTACH DATABASE '/path/to/converted.db' AS converted KEY 'your passphrase';
SELECT sqlcipher_export('converted');
PRAGMA converted.user_version = 12; -- the old database's PRAGMA user_version: see below
DETACH DATABASE converted;
```

Then:

- **Copy `user_version`.** `sqlcipher_export()` copies tables, indexes, triggers and data, but not `PRAGMA user_version`, and that is where WatermelonDB and NitromelonDB keep the schema version. Read it from the old database (`PRAGMA user_version`) and set it on the new one, as above. Without it, the new database looks like schema version 0.
- **If your app sets `cipher_default_*` pragmas,** don't set them in the converting version: they change the defaults for every database the process opens or attaches afterwards, `converted` included.
- **Replace the old file.** Close every connection, delete the old database with its `-wal` and `-shm` files, and rename `converted.db` to the old name. Until the rename, the old database is untouched, so if the app is killed in the middle, the next launch starts over. Check there's enough free space for the copy first.

### Users who skip the converting version

Someone who updates straight from an older version of your app to the NitromelonDB version still has the old format. NitromelonDB can't open it: setup fails with `encryption_key_invalid`. Decide in advance what that version does then:

- **If the data syncs:** delete the database and download it again. A [Turbo Login](../Sync/Frontend.md#advanced-adopting-turbo-login) makes that first sync fast.
- **If it doesn't:** the data is only readable by the old library. Keep the converting version available long enough, and consider telling these users to contact you rather than deleting their data.

Don't reset the database automatically on `encryption_key_invalid` in other situations: it's also the error for a wrong passphrase ([Errors and troubleshooting](./Troubleshooting.md)).

## Check it worked

- On a copy of a real database from your current app, opened by the NitromelonDB version: setup succeeds, `await database.isDBEncrypted()` is `true`, and your records are there.
- If you migrated: the same, on a database the converting version converted, and the schema version is the one you expect (no migrations run again, nothing reset).
