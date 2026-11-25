---
title: 'Turn it on'
sidebar_label: 'Turn it on'
hide_title: true
description: 'Turn on the encryption build with one package.json switch, rebuild for iOS, Android and Windows, use it on Node and Electron, and check that it worked.'
---

# Turn it on

## 1. Add the switch to your app's `package.json`

```json title="package.json"
{
  "name": "my-app",
  "nitromelondb": {
    "encryption": true
  }
}
```

That's the one switch for iOS, Android and Windows, in Expo and bare React Native apps alike.

- The value must be a JSON boolean. `"true"` (a string) is an error, so a typo can't silently give you the wrong build.
- The builds use the **first `package.json` above the native project**: above `ios/` (the folder with the `Podfile`), `android/`, or the Windows solution. In a standard app that is the app's own `package.json`. In a monorepo, put the key in the app package's `package.json`, not the workspace root, unless the native folders live at the root. NitromelonDB's own `package.json` is skipped.
- On Windows the file is read with a simple pattern, so keep `"nitromelondb"` a flat object: `{ "encryption": true }`.

## 2. Rebuild the native app

The switch is read when the native project is built, so changing it needs a native rebuild. Reloading JavaScript is not enough.

**Expo (development builds, EAS Build)**

```bash
npx expo prebuild --clean
npx expo run:ios      # or run:android
```

EAS Build reads `package.json` like a local build does: commit the change and build. There is no config plugin option for this: passing `encryption` to the `nitromelondb` plugin fails with a message pointing here, so that it can't be silently ignored.

**Bare React Native, iOS**

```bash
cd ios && pod install
```

CocoaPods decides which SQLite to compile and link while it installs, so run `pod install` after every change to the switch. Then build as usual.

**Bare React Native, Android**

Build as usual (`yarn android`, `./gradlew assembleRelease`). Gradle reads the switch on every build. If an old build seems to stick, run `./gradlew clean` once.

**Windows**

Rebuild the solution. MSBuild reads the switch on every build.

## Overriding the switch (CI, release variants)

The `NITROMELONDB_ENCRYPTION` environment variable wins over `package.json` on every platform. `1` or `true` turns encryption on, `0` or `false` turns it off, and anything else is an error. For example, to try the encryption build on CI without committing the switch:

```bash
NITROMELONDB_ENCRYPTION=1 npx expo prebuild --clean
NITROMELONDB_ENCRYPTION=1 bundle exec pod install
NITROMELONDB_ENCRYPTION=1 ./gradlew assembleRelease
```

On Windows you can also pass the MSBuild property: `msbuild /p:NitromelonDBEncryption=true`. It wins over both.

All builds of one app should agree. Once a database has been encrypted, a build without encryption can't open it: setup fails with `encryption_key_required`, and the file is left alone.

## Node.js and Electron

There's no build switch: install [`better-sqlite3-multiple-ciphers`](https://github.com/m4heshd/better-sqlite3-multiple-ciphers), which is `better-sqlite3` with SQLite3 Multiple Ciphers inside (the same sqlite3mc and SQLite versions as the native encryption build). When it's installed, NitromelonDB uses it instead of `better-sqlite3`, with or without a passphrase, so you can remove `better-sqlite3`.

```bash
yarn add better-sqlite3-multiple-ciphers
# Electron: rebuild it for Electron, like better-sqlite3
npx electron-rebuild -f -w better-sqlite3-multiple-ciphers
```

`SQLiteAdapter.isEncryptionAvailable()` is then `true`. The `encryption` option, the errors and the file format are the same as in the apps: a database encrypted on Node opens on iOS, Android and Windows with the same passphrase, and the other way around (we test both directions). Three things differ:

- **A file that isn't a plain SQLite database**, opened without a passphrase, fails with `encryption_key_required` and is left alone, as in the apps. With plain `better-sqlite3` it's treated as a damaged database, as before, which `unsafeResetDatabase()` recreates.
- **Other connections.** Encrypting, changing the passphrase or decrypting fails with `rekey_failed` (changing nothing) while another adapter in the same process has the file open. Connections in other processes can't be detected on Node (the Node adapter doesn't use WAL mode): close them first. See [More than one connection](./MultipleConnections.md).
- **Decrypting** writes an encrypted copy, decrypts the copy, then replaces the database with it. It needs free space for the copy, and takes longer than in the apps.

If your own code also opens the database file with `better-sqlite3` (or another SQLite library), switch that to `better-sqlite3-multiple-ciphers` too, or open the file only through NitromelonDB. On macOS and Linux, two copies of SQLite in one process break each other's file locks: when one closes the file, the other's locks are released too ([SQLite: How To Corrupt](https://sqlite.org/howtocorrupt.html#multiple_copies_of_sqlite_linked_into_the_same_application)), so writes from both can corrupt the database. On every platform, plain `better-sqlite3` can't read an encrypted file anyway (see "Other SQLite libraries in your app" in [What changes in the encryption build](./HowItWorks.md#what-changes-in-the-encryption-build)).

In Electron, SQLite runs in the main process, so that's where the passphrase is read (for example with Electron's `safeStorage`).

## Check that it worked

**In the build output**, the encryption build announces itself:

| Platform | Where                | Line                                                                |
| -------- | -------------------- | ------------------------------------------------------------------- |
| iOS      | `pod install` output | `[NitromelonDB] SQLite encryption build (SQLite3 Multiple Ciphers)` |
| Android  | Gradle output        | `NitromelonDB: SQLite encryption build (SQLite3 Multiple Ciphers)`  |
| Windows  | MSBuild output       | `NitromelonDB: SQLite encryption build (SQLite3 Multiple Ciphers)`  |

No line means the default build.

**In the running app**, ask SQLite. Any collection works, the query doesn't touch its table:

```js
import { Q } from 'nitromelondb'

async function encryptionBuildVersion(database) {
  try {
    const [row] = await database
      .get('posts')
      .query(Q.unsafeSqlQuery('select sqlite3mc_version() as version'))
      .unsafeFetchRaw()
    return row.version // "SQLite3 Multiple Ciphers 2.7.1"
  } catch (error) {
    return null // "no such function: sqlite3mc_version": the default build
  }
}
```

This is for checking your setup in development. In code, use `SQLiteAdapter.isEncryptionAvailable()`, and rely on the `encryption` option to fail loudly when the build is wrong (see [Errors](./Troubleshooting.md#errors)).
