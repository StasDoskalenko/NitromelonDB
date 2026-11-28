---
title: 'Encryption'
sidebar_label: 'Intro'
hide_title: true
description: 'Opt-in database encryption in the SQLCipher 4 format, on iOS, Android, Windows, Node and Electron: what it protects, why it is a build switch, and where to start.'
---

# Encryption

NitromelonDB can encrypt the SQLite database on disk, in the same file format as [SQLCipher](https://www.zetetic.net/sqlcipher/) 4. Encryption is **opt-in, at build time**: apps that don't ask for it ship exactly what they shipped before, with no cryptography from NitromelonDB in them.

Using it takes two steps:

1. [Turn on the encryption build](./Setup.md), so the code that can encrypt is compiled into your app.
2. [Give `SQLiteAdapter` a passphrase](./Passphrase.md). For an app that already has users with plain databases, [encrypt them in place](./ExistingUsers.md).

:::note Status
The encryption build and the passphrase API work on iOS, Android and Windows, and on Node.js and Electron with [`better-sqlite3-multiple-ciphers`](./Setup.md#nodejs-and-electron) ([#60](https://github.com/StasDoskalenko/NitromelonDB/issues/60)). The web (LokiJS, wa-sqlite) refuses the `encryption` option with an error.
:::

## In this section

- [Turn it on](./Setup.md): the `package.json` switch, rebuilding, Node.js and Electron, and checking that it worked.
- [Open an encrypted database](./Passphrase.md): the `encryption` option, and where to keep the passphrase.
- [Existing users](./ExistingUsers.md): encrypt plain databases from earlier versions of your app in place, show progress (`useEncryption`), and check the state.
- [Change, decrypt, log out](./ChangePassphrase.md): change the passphrase, go back to a plain file, and wipe the data when a user logs out.
- [More than one connection](./MultipleConnections.md): app extensions, widgets and second adapters, and a plaintext header for iOS App Groups.
- [Coming from SQLCipher](./ComingFromSqlcipher.md): databases your app already encrypted with SQLCipher (a patched WatermelonDB, Room, expo-sqlite, op-sqlite), and migrating the ones in older formats.
- [Errors and troubleshooting](./Troubleshooting.md): error codes, and common problems.
- [How it works](./HowItWorks.md): what the encryption build changes, the file format, and what we test.
- [App Store and export compliance](./ExportCompliance.md): what to answer Apple.

With an AI coding agent, the [`nitromelondb-encryption`](../AgentSkills.md) skill walks through this section in your app.

## At a glance

|                                            | Default build                                        | Encryption build                                                                                              |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| How to get it                              | nothing to do                                        | `"nitromelondb": { "encryption": true }` in your app's `package.json`                                         |
| SQLite on iOS                              | the system `libsqlite3`                              | bundled [SQLite3 Multiple Ciphers](https://github.com/utelle/SQLite3MultipleCiphers) (built on SQLite 3.54.1) |
| SQLite on Android and Windows              | bundled SQLite 3.54.1                                | bundled SQLite3 Multiple Ciphers (built on SQLite 3.54.1)                                                     |
| SQLite on Node.js and Electron             | `better-sqlite3`                                     | `better-sqlite3-multiple-ciphers` ([no build switch](./Setup.md#nodejs-and-electron))                         |
| Can encrypt a database                     | no: a passphrase fails with `encryption_unavailable` | yes                                                                                                           |
| Cryptography in your app from NitromelonDB | none                                                 | AES-256, HMAC-SHA512, PBKDF2 (all standard)                                                                   |
| App size (per arm64 slice)                 | unchanged                                            | about +1.2 MB on iOS, about +110 KB on Android                                                                |
| Databases without a key                    | plain SQLite files                                   | plain SQLite files, byte for byte the same                                                                    |

## Why it's a switch and not just an option

We want moving from WatermelonDB to be as easy as possible: change the package, rebuild, and your app works and ships as before. Compiling encryption into every app would break that, even for apps that never set a key:

1. **The SQLite engine on iOS.** Like WatermelonDB, NitromelonDB uses the system SQLite on iOS by default. The system one can't encrypt, so the encryption build bundles its own. It matches the settings of Apple's build (see [What changes in the encryption build](./HowItWorks.md#what-changes-in-the-encryption-build)), but it is a different engine, and you should choose when to switch.
2. **App size.** The cipher adds about 1.2 MB per arm64 slice on iOS and about 110 KB on Android (before App Store thinning and compression).
3. **Export compliance.** An app that contains encryption has to say so to Apple, including encryption in the libraries it links. With the cipher in every build, some publishers would have to change their answers, and possibly file a French encryption declaration, just by updating. Details in [App Store and export compliance](./ExportCompliance.md).

The switch is a key in your app's `package.json` because CocoaPods, Gradle and MSBuild all read that file, so all three builds get the same answer.

## Should you turn it on?

Encryption at rest protects the database **file**. It helps when someone gets a copy of that file without the key:

- a backup that includes the app's data,
- a lost, stolen or seized device that is unlocked, rooted or jailbroken, or examined with forensic tools,
- malware or another app that can read your app's files but not its memory or Keychain / Keystore entries,
- an auditor or a customer contract that requires application-level encryption of stored data (common in health, finance and enterprise apps).

It does **not** protect against:

- code running inside your app, or a debugger attached to it. While the database is open, the key is in memory.
- a key stored somewhere an attacker can read. Where you keep the passphrase (Keychain, Android Keystore, derived from the user's password, fetched from your server) decides how much the encryption is worth.
- data you send elsewhere: sync payloads, logs, crash reports, analytics.

Also keep in mind that iOS and Android already encrypt app storage while the device is locked (iOS Data Protection, Android file-based encryption). Database encryption adds protection on top of that, mostly while the device is unlocked, in backups, and on compromised devices. If none of the cases above apply to your app, you probably don't need it.

## Limits

The design is in the [encryption plan](https://github.com/StasDoskalenko/NitromelonDB/blob/master/docs/plans/sqlcipher-encryption.md), and everything in it is implemented. What it doesn't do:

- **The web** (LokiJS, wa-sqlite) has no encryption: the `encryption` option, `getDatabaseEncryptionState()` and the encryption calls fail with `encryption_unavailable`.
- **One format: SQLCipher 4 with its default settings.** A passphrase or a [raw key](./ComingFromSqlcipher.md#a-raw-key), but no other SQLCipher settings (`kdf_iter`, page size, SQLCipher 3 compatibility). A database in another format must be converted first: [Coming from SQLCipher](./ComingFromSqlcipher.md).
- **`plaintextHeader`** is for iOS App Groups, where it is needed; it works on Android and Windows too, but not on Node and Electron, which refuse it.
