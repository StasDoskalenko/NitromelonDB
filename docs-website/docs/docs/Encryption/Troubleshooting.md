---
title: 'Errors and troubleshooting'
sidebar_label: 'Errors and troubleshooting'
hide_title: true
description: 'Encryption error codes and what to do about them, and answers to common problems with the encryption build.'
---

# Errors and troubleshooting

## Errors

Errors from opening or re-keying have a `code`:

| `error.code`              | When                                                                                                                                                                      | What to do                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `encryption_unavailable`  | `encryption` passed to a build without the encryption switch, or on Node without `better-sqlite3-multiple-ciphers`, or on web (thrown by the `SQLiteAdapter` constructor) | [Turn on the build](./Setup.md) and rebuild. See [Troubleshooting](#troubleshooting). |
| `encryption_key_invalid`  | the passphrase is wrong, or the file isn't a database encrypted by NitromelonDB / SQLCipher 4                                                                             | Use the right passphrase. The file is unchanged.                                      |
| `encryption_key_required` | the database is encrypted (or damaged), and no passphrase was given: a build or code path without `encryption`                                                            | Pass the passphrase. The file is unchanged.                                           |
| `database_not_encrypted`  | a passphrase was given, but the database is a plain SQLite file                                                                                                           | Use `ifUnencrypted: 'open'` and `unsafe_EncryptDB()`.                                 |
| `encryption_salt_missing` | the database has a plaintext header (`plaintextHeader`), and its salt file next to it is missing or damaged                                                               |
| `rekey_failed`            | encrypting, changing the key or decrypting failed (e.g. disk full)                                                                                                        | The database keeps its previous state.                                                |

```js
database.readyPromise.catch((error) => {
  if (error.code === 'encryption_key_invalid') {
    // ...
  }
})
```

## Troubleshooting

**I turned it on, but the build line doesn't show up.**

- iOS: run `pod install` again (Expo: `npx expo prebuild --clean`). CocoaPods only reads the switch while it installs.
- Check which `package.json` the build sees: the first one above `ios/`, `android/` or the Windows solution. In a monorepo that is usually the app package's, not the workspace root.
- Check that `NITROMELONDB_ENCRYPTION` isn't set to `0` in your shell or on CI. It wins over `package.json`.

**The build fails with `must be true or false`.** The value in `package.json` must be a JSON boolean, `true` or `false`, not `"true"`. `NITROMELONDB_ENCRYPTION` accepts `1`, `0`, `true` and `false`.

**Duplicate symbols, or `redefinition of sqlite3_mem_methods`, with another SQLite library.** The encryption build hides its SQLite symbols, so it shouldn't cause these. If you see them, make sure the new pods were installed (`pod install`, or a clean prebuild), and [open an issue](https://github.com/StasDoskalenko/NitromelonDB/issues) with the full error.

**`encryption_unavailable`, although I turned the switch on.** The JavaScript is newer than the native build, or the switch didn't reach it. Check the build log for the line in [Check that it worked](./Setup.md#check-that-it-worked), and see the first question above.

**Setup fails with `encryption_key_invalid` after an update or a restore.** The passphrase your app found isn't the one the database was encrypted with: for example, the Keychain item didn't survive a restore to a new device, or a new passphrase was generated although one existed. NitromelonDB leaves the file alone, so if the old passphrase can be found, it opens again. If it can't, the data in that file is gone; data your app syncs can be downloaded again into a new database (delete the old file, or use a new `dbName`).

**Does it make the app slower?** Without a key, no: the encryption build is as fast as the default build. With a key, opening derives the key from the passphrase once per launch (79 ms on a fast desktop, several times that on a slow phone), and pages read from the file or written to it are decrypted or encrypted and authenticated: reads that miss SQLite's page cache take four to seven times as long, writes about twice, and reads from the cache cost the same. Numbers and details: [What it costs](./HowItWorks.md#what-it-costs). Measure on the slowest device you support.

**Can I turn it off again?** Yes, for as long as none of your databases are encrypted. If some are, decrypt them first (`unsafe_DecryptDB()`), in a version of your app that still has the encryption build, then remove the switch.
