---
title: Encryption
hide_title: true
description: 'Opt-in database encryption for iOS, Android and Windows: why it is a build switch, how to turn it on, how to open, encrypt and migrate databases with a passphrase, and what it means for App Store export compliance.'
---

# Encryption

NitromelonDB can encrypt the SQLite database on disk, in the same file format as [SQLCipher](https://www.zetetic.net/sqlcipher/) 4. Encryption is **opt-in, at build time**: apps that don't ask for it ship exactly what they shipped before, with no cryptography from NitromelonDB in them.

Using it takes two steps:

1. [Turn on the encryption build](#turn-it-on), so the code that can encrypt is compiled into your app.
2. [Give `SQLiteAdapter` a passphrase](#open-an-encrypted-database). For an app that already has users with plain databases, [encrypt them in place](#add-encryption-to-an-app-that-already-has-users).

:::note Status
The encryption build and the passphrase API work on iOS, Android and Windows ([#60](https://github.com/StasDoskalenko/NitromelonDB/issues/60)). Progress events during a long encryption, and Node/Electron support, come next (see [What's next](#whats-next)). The web (LokiJS, wa-sqlite) refuses the `encryption` option with an error.
:::

## At a glance

|                                            | Default build                                        | Encryption build                                                                                              |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| How to get it                              | nothing to do                                        | `"nitromelondb": { "encryption": true }` in your app's `package.json`                                         |
| SQLite on iOS                              | the system `libsqlite3`                              | bundled [SQLite3 Multiple Ciphers](https://github.com/utelle/SQLite3MultipleCiphers) (built on SQLite 3.54.1) |
| SQLite on Android and Windows              | bundled SQLite 3.54.1                                | bundled SQLite3 Multiple Ciphers (built on SQLite 3.54.1)                                                     |
| Can encrypt a database                     | no: a passphrase fails with `encryption_unavailable` | yes                                                                                                           |
| Cryptography in your app from NitromelonDB | none                                                 | AES-256, HMAC-SHA512, PBKDF2 (all standard)                                                                   |
| App size (per arm64 slice)                 | unchanged                                            | about +1.2 MB on iOS, about +110 KB on Android                                                                |
| Databases without a key                    | plain SQLite files                                   | plain SQLite files, byte for byte the same                                                                    |

## Why it's a switch and not just an option

You might expect encryption to be an option on `SQLiteAdapter` and nothing else. The option is coming, but the code that does the encrypting has to be compiled into your app first, and that code has consequences for every app that contains it, whether or not it ever sets a key:

1. **Export compliance.** Apps that contain encryption have to say so, and Apple's question covers your app "including any third-party libraries it links against". If NitromelonDB compiled its cipher into every app, every app using NitromelonDB would contain encryption, and some publishers would have to change their answers to Apple, and possibly file a French encryption declaration, without having changed anything. Keeping it behind a switch means the default build contains no cryptography from NitromelonDB, and nothing changes for you unless you decide it should. Details in [App Store and export compliance](#app-store-and-export-compliance).
2. **App size.** The cipher, and on iOS a bundled SQLite instead of the system's, add about 1.2 MB per arm64 slice on iOS and about 110 KB on Android (before App Store thinning and compression).
3. **The SQLite engine on iOS.** By default iOS uses the system SQLite. The encryption build bundles its own, because the system one can't encrypt. We match the settings of Apple's build (see [What changes in the encryption build](#what-changes-in-the-encryption-build)), but it is a different engine, and you should get to choose when that happens.

Why not an Expo-only setting, or a runtime check? Because the decision has to reach three native build systems (CocoaPods, Gradle and MSBuild), and has to be the same in all of them. A single key in `package.json`, which all three read, is the one place every React Native app already has.

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

## Turn it on

### 1. Add the switch to your app's `package.json`

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

### 2. Rebuild the native app

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

### Overriding the switch (CI, release variants)

The `NITROMELONDB_ENCRYPTION` environment variable wins over `package.json` on every platform. `1` or `true` turns encryption on, `0` or `false` turns it off, and anything else is an error. For example, to try the encryption build on CI without committing the switch:

```bash
NITROMELONDB_ENCRYPTION=1 npx expo prebuild --clean
NITROMELONDB_ENCRYPTION=1 bundle exec pod install
NITROMELONDB_ENCRYPTION=1 ./gradlew assembleRelease
```

On Windows you can also pass the MSBuild property: `msbuild /p:NitromelonDBEncryption=true`. It wins over both.

All builds of one app should agree. Once a database has been encrypted, a build without encryption can't open it: setup fails with `encryption_key_required`, and the file is left alone.

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

This is for checking your setup in development. In code, use `SQLiteAdapter.isEncryptionAvailable()`, and rely on the `encryption` option to fail loudly when the build is wrong (see [Errors](#errors)).

## Open an encrypted database

Pass `encryption` to `SQLiteAdapter`:

```js
import SQLiteAdapter from 'nitromelondb/adapters/sqlite'

const adapter = new SQLiteAdapter({
  schema,
  migrations,
  encryption: {
    // A string, or a function that returns one (or a Promise of one)
    passphrase: getPassphrase,
  },
})
```

- **A new database is created encrypted.** From the first byte written, the file on disk is SQLCipher 4, not SQLite.
- **The passphrase can come later.** With a function, NitromelonDB calls it once, when the adapter is created, and every database call (queries, writes, `database.write()`) waits for it. You don't need to restructure your app's startup around the Keychain.
- **"No passphrase" is an error, never "open unencrypted".** If the function returns `null`, `undefined` or `''`, or throws, setup fails and every waiting call fails with that error. A wiped Keychain entry can't silently turn into a plaintext database.
- **Errors never touch the file.** A wrong passphrase, a missing one, or a plain database where an encrypted one was expected fails setup with an [error code](#errors). NitromelonDB does not reset or recreate the database in any of these cases, not even through `unsafeResetDatabase()`.

Setup errors come out where they always do: `adapter.initializingPromise` and `database.readyPromise` reject, and `onSetUpError` is called.

### Where to keep the passphrase

The passphrase is only as safe as the place you keep it. For most apps: generate a random one on first launch and keep it in the **iOS Keychain / Android Keystore**. With Expo:

```js
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import SQLiteAdapter from 'nitromelondb/adapters/sqlite'

const PASSPHRASE_KEY = 'database-passphrase'

async function getPassphrase() {
  const saved = await SecureStore.getItemAsync(PASSPHRASE_KEY)
  if (saved) {
    return saved
  }
  // Only make a new one for a new database. If the file exists and is encrypted, its passphrase
  // was lost: a new one wouldn't open it (setup would fail with encryption_key_invalid)
  if ((await SQLiteAdapter.getDatabaseEncryptionState()) === 'encrypted') {
    throw new Error('The database passphrase is missing from the Keychain')
  }
  const passphrase = Array.from(Crypto.getRandomBytes(32), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  await SecureStore.setItemAsync(PASSPHRASE_KEY, passphrase, {
    // Readable by background tasks after the device was unlocked once since boot
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  })
  return passphrase
}
```

In a bare app, `react-native-keychain` does the same job. Some things to decide for your app:

- **Background work** (headless JS, background fetch) needs to read the passphrase while the device may be locked. `AFTER_FIRST_UNLOCK` allows that; stricter classes like `WHEN_UNLOCKED` don't.
- **Device backups and new phones.** Keychain items that sync or migrate with the device keep the database readable after a restore; items that don't (`*_THIS_DEVICE_ONLY`) make a restored database unreadable on the new device, which you may want, or not.
- **A passphrase derived from the user's password** protects the data even from someone who can read the Keychain, but the database can then only be opened after the user signs in, and a forgotten password means the local data is gone (it can still be synced down again).
- **There is no recovery.** If the passphrase is lost, the database can't be opened, by you or by anyone. Plan for that: data that is synced to your server can be downloaded into a new database.

NitromelonDB never logs the passphrase. While the database is open, the native side keeps it in memory (to reopen the file after decrypting it), next to the key SQLite derives from it, which any encrypted database needs while it's open; both go away when it closes. On the JavaScript side, a passphrase function is called once and its result isn't kept; a passphrase passed as a string stays in your adapter options. Don't put a passphrase in your JavaScript bundle or `app.json`: anyone can read those.

## Add encryption to an app that already has users

Your users' databases are plain SQLite files. Turning on the encryption build doesn't change them, and opening them with a passphrase fails with `database_not_encrypted`, unless you ask NitromelonDB to open them as they are, so you can encrypt them:

```js
const adapter = new SQLiteAdapter({
  schema,
  migrations,
  encryption: {
    passphrase: getPassphrase,
    // A plain database (from an earlier version of the app) opens unencrypted
    ifUnencrypted: 'open',
    events: {
      onStart: ({ operation, byteSize }) => showProgress(operation, byteSize),
      onSuccess: ({ durationMs }) => hideProgress(),
      onError: (error) => reportError(error),
    },
  },
})
const database = new Database({ adapter, modelClasses })

// Once, after launch (e.g. on your first screen):
async function encryptIfNeeded() {
  if (!(await database.isDBEncrypted())) {
    const passphrase = await getPassphrase() // saved before encrypting
    await database.write(async () => {
      await database.unsafe_EncryptDB(passphrase)
    })
  }
}
```

What `unsafe_EncryptDB()` does:

- **Encrypts in place.** Every record, every table, local storage and the sync state stay as they were. No second file, no re-download.
- **Must run in a writer**, so no other write can run meanwhile. Reads made in the meantime wait until it's done; your UI keeps running, and observers keep their data.
- **Takes a while on a big database**: it rewrites every page. `events.onStart` tells you the size (`byteSize`), so you can decide to show something. While it runs, it can need free disk space of up to about three times the database's size.
- **Survives being killed.** If the app is killed in the middle (by the user, or by the OS in the background), the database opens afterwards either as it was (plain) or fully encrypted, never half-way: on the next launch, NitromelonDB finishes rolling back the interrupted encryption before it opens the file. If it's still plain, `isDBEncrypted()` says so, and your code encrypts it again. We test this by killing the process at points throughout the encryption, and by crashing it exactly at its commit. We test this by killing the process at points throughout the encryption, re-key and decryption, and checking that every database opens, complete, with either the old or the new passphrase.
- **Save the passphrase first.** From then on the database opens only with it.

New installs don't need any of this: with a passphrase, a new database is created encrypted. `isDBEncrypted()` is already `true` for them.

Keep `ifUnencrypted: 'open'` for as long as users may still update from a version without encryption. Afterwards you can remove it, so that a plain database (which shouldn't exist any more) is an error.

## Check the state

| Question                                          | API                                                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Is this build able to encrypt?                    | `SQLiteAdapter.isEncryptionAvailable()`: `true` in the encryption build                                                 |
| Is the database I have open encrypted?            | `await database.isDBEncrypted()`. Waits for setup. The definitive answer.                                               |
| Is the file on disk encrypted, before opening it? | `await SQLiteAdapter.getDatabaseEncryptionState(dbName)`: `'encrypted'`, `'unencrypted'` or `'missing'` (a new install) |

`getDatabaseEncryptionState()` only reads the first bytes of the file, so it's cheap and needs no passphrase. Its `'unencrypted'` is certain (a plain SQLite file starts with `SQLite format 3`). Its `'encrypted'` really means "not a plain SQLite file": a damaged file looks the same. Only opening it with the passphrase proves it's encrypted.

## Change the passphrase, or decrypt

```js
// On an encrypted database, unsafe_EncryptDB() changes the passphrase
await database.write(async () => {
  await database.unsafe_EncryptDB(newPassphrase)
})

// Back to a plain SQLite file
await database.write(async () => {
  await database.unsafe_DecryptDB()
})
```

Both run in a writer and are safe to kill, like encrypting:

- **Changing the passphrase** works in place. If it's cut off, the database still has the **old** passphrase. So save the new one before you call it, but keep the old one until the call has finished; on a launch after an interrupted change, if setup fails with `encryption_key_invalid`, open with the old passphrase (the error message says so too) and change it again.
- **Decrypting** writes a decrypted copy next to the database and then replaces the file with it, in one step. It needs free space for the copy. If it's cut off before that step, the database is untouched and still encrypted (the leftover copy is deleted on the next launch); after it, the database is plain. After decrypting, the next launch needs `ifUnencrypted: 'open'` (or no `encryption` option at all) to open the plain file.

## Errors

Errors from opening or re-keying have a `code`:

| `error.code`              | When                                                                                                                     | What to do                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `encryption_unavailable`  | `encryption` passed to a build without the encryption switch (thrown by the `SQLiteAdapter` constructor), or on web/Node | [Turn on the build](#turn-it-on) and rebuild. See [Troubleshooting](#troubleshooting). |
| `encryption_key_invalid`  | the passphrase is wrong, or the file isn't a database encrypted by NitromelonDB / SQLCipher 4                            | Use the right passphrase. The file is unchanged.                                       |
| `encryption_key_required` | the database is encrypted (or damaged), and no passphrase was given: a build or code path without `encryption`           | Pass the passphrase. The file is unchanged.                                            |
| `database_not_encrypted`  | a passphrase was given, but the database is a plain SQLite file                                                          | Use `ifUnencrypted: 'open'` and `unsafe_EncryptDB()`.                                  |
| `rekey_failed`            | encrypting, changing the key or decrypting failed (e.g. disk full)                                                       | The database keeps its previous state.                                                 |

```js
database.readyPromise.catch((error) => {
  if (error.code === 'encryption_key_invalid') {
    // ...
  }
})
```

## What we test

- **Native, on every CI run, both builds:** opening with the right, wrong and missing passphrase, plain databases with and without `ifUnencrypted`, encrypting, changing the passphrase and decrypting from WAL mode, and two kinds of interruption: killing the process at points throughout each of them on a 10 MB database, and crashing it exactly at the two moments of the commit where a database is most at risk (right after the first page is rewritten, and right before the journal is deleted). Each time, the database opens, complete, with the old or the new passphrase. The default build must refuse a passphrase.
- **JavaScript (Jest):** passphrase functions (including ones that fail), the order of calls made before the passphrase arrives and during a re-key, events, error codes, and that keying errors never lead to a reset.
- **On a device (iOS simulator, CI):** the whole upgrade, with real builds. The plain build of our example app creates a database; the encryption build is installed over it, opens it, and encrypts it; the test then reads the file from the app's container to check it has no SQLite header and that a note's text can't be found in any database file; a cold start opens it with the passphrase; the plain build, installed over it, fails with `encryption_key_required` and leaves the file byte for byte unchanged; and the encryption build opens it again with every note.
- **Not yet on a device in CI:** the Android and Windows encryption builds. They run the same C++ code as iOS, and the Android one was built and checked locally, but CI only builds their default variants so far.

## What changes in the encryption build

**The engine.** The encryption build compiles [SQLite3 Multiple Ciphers](https://github.com/utelle/SQLite3MultipleCiphers) (sqlite3mc, MIT licensed) on every platform. It is unmodified SQLite plus an encryption layer, and NitromelonDB's copy is always built on the same SQLite version as the default build (3.54.1 today), so switching between the two never changes how your SQL behaves on Android and Windows.

**On iOS** it replaces the system SQLite. To keep behavior the same, it is built with the settings of Apple's SQLite that an app can notice:

- WAL commits without `fsync` (`synchronous = NORMAL`), and a full sync at checkpoints, so writes are as fast as before,
- full-text search (FTS3, FTS4, FTS5), R*Tree and math functions, for anyone using them through `Q.unsafeSqlQuery`,
- up to 500,000 bound variables per statement.

**Your existing databases.** With no key set, the encryption build reads and writes ordinary SQLite files, byte for byte the same as before. Turning the switch on doesn't touch a single database, and turning it off again is safe for as long as none of your databases has been encrypted.

**The format.** Encrypted databases use the SQLCipher 4 format with its defaults: AES-256-CBC, HMAC-SHA512 page authentication, and keys derived with PBKDF2-HMAC-SHA512 over 256,000 iterations. Only this one cipher is compiled in. Any SQLCipher 4 tool can open these files with the key, which helps when you debug: the `sqlcipher` command-line shell, or [DB Browser for SQLite](https://sqlitebrowser.org/) with SQLCipher support.

**Other SQLite libraries in your app.** The encryption build hides all of its SQLite symbols. An app can also contain `expo-sqlite`, `op-sqlite`, the SQLCipher pod or the system SQLite without duplicate-symbol errors, and without one library quietly running on another's SQLite. One rule: two SQLite libraries in one app must not open the **same database file**, because they don't share file locks.

## App Store and export compliance

:::danger Not legal advice
This section explains what we know and where to look. Export rules differ by country and change over time, and your obligations depend on your app and where you distribute it. Check Apple's current guidance, and ask someone qualified if you are unsure.
:::

**The App Store does not forbid encryption.** Many approved apps bundle their own cryptography (SQLCipher, Realm's encrypted databases, Signal, anything built on OpenSSL). What Apple asks about is **export compliance**: when you upload an app, you export it from the US, and an app that contains encryption is subject to US export rules (and to the import rules of the countries you distribute in). So App Store Connect asks about encryption for every new version, and the answer covers your app **"including any third-party libraries it links against"**, in Apple's words. That sentence is the reason the cipher is opt-in.

**With the default build**, NitromelonDB adds no cryptography to your app. Whatever you answer Apple today stays correct.

**With the encryption build**, your app contains encryption that isn't part of iOS: NitromelonDB's bundled AES-256, HMAC-SHA512 and PBKDF2-HMAC-SHA512. These are industry-standard algorithms (published, and accepted by standards bodies), used to protect your app's own data at rest.

Apple's [reference table](https://developer.apple.com/help/app-store-connect/reference/export-compliance-documentation-for-encryption) sorts apps into three cases:

| Your app uses                                                                                         | Documentation Apple asks for                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| only encryption within Apple's operating system (HTTPS with `URLSession`, CommonCrypto, the Keychain) | none                                                                                 |
| **an industry-standard algorithm not provided by the operating system**: the encryption build         | a French encryption declaration, **only if** you distribute in France                |
| proprietary algorithms not accepted by standards bodies                                               | a US classification (CCATS), plus the French declaration if you distribute in France |

So with the encryption build, expect to answer that your app uses encryption, that it is standard and not provided by iOS, and, if your app is on the App Store in France, to upload a French encryption declaration. Apple's overview also mentions that some apps need to send the US government a year-end self-classification report. Check whether that applies to you.

To avoid answering on every upload, record your answer in the app's `Info.plist`:

- `ITSAppUsesNonExemptEncryption`. Apple says `NO` means no encryption, or only exempt forms of it. With the encryption build, work out your answer with Apple's guides rather than assuming `NO`.
- `ITSEncryptionExportComplianceCode`, if Apple gives you a code after reviewing documentation you uploaded.
- In Expo, `ITSAppUsesNonExemptEncryption` is `ios.config.usesNonExemptEncryption` in `app.json`. Add the compliance code through `ios.infoPlist`.

Google Play has no export-compliance questionnaire like Apple's, but export rules apply to you as the publisher however you distribute the app.

Where to read more:

- Apple: [Complying with encryption export regulations](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations) (the `Info.plist` keys)
- Apple: [Export compliance documentation for encryption](https://developer.apple.com/help/app-store-connect/reference/export-compliance-documentation-for-encryption) (the table above) and [Determine and upload app encryption documentation](https://developer.apple.com/help/app-store-connect/manage-app-information/determine-and-upload-app-encryption-documentation)
- US Bureau of Industry and Security: [Encryption](https://www.bis.gov/learn-support/encryption-controls)

## What's next

The design is in the [encryption plan](https://github.com/StasDoskalenko/NitromelonDB/blob/master/docs/plans/sqlcipher-encryption.md). Still to come:

1. **Progress events** while a big database is encrypted (`onStart` and `onSuccess` exist today).
2. **Node and Electron** support through `better-sqlite3-multiple-ciphers`.
3. **Device tests of the Android and Windows encryption builds** on CI, like the iOS one.

The web (LokiJS, wa-sqlite) is not part of this work.

## Troubleshooting

**I turned it on, but the build line doesn't show up.**

- iOS: run `pod install` again (Expo: `npx expo prebuild --clean`). CocoaPods only reads the switch while it installs.
- Check which `package.json` the build sees: the first one above `ios/`, `android/` or the Windows solution. In a monorepo that is usually the app package's, not the workspace root.
- Check that `NITROMELONDB_ENCRYPTION` isn't set to `0` in your shell or on CI. It wins over `package.json`.

**The build fails with `must be true or false`.** The value in `package.json` must be a JSON boolean, `true` or `false`, not `"true"`. `NITROMELONDB_ENCRYPTION` accepts `1`, `0`, `true` and `false`.

**Duplicate symbols, or `redefinition of sqlite3_mem_methods`, with another SQLite library.** The encryption build hides its SQLite symbols, so it shouldn't cause these. If you see them, make sure the new pods were installed (`pod install`, or a clean prebuild), and [open an issue](https://github.com/StasDoskalenko/NitromelonDB/issues) with the full error.

**`encryption_unavailable`, although I turned the switch on.** The JavaScript is newer than the native build, or the switch didn't reach it. Check the build log for the line in [Check that it worked](#check-that-it-worked), and see the first question above.

**Setup fails with `encryption_key_invalid` after an update or a restore.** The passphrase your app found isn't the one the database was encrypted with: for example, the Keychain item didn't survive a restore to a new device, or a new passphrase was generated although one existed. NitromelonDB leaves the file alone, so if the old passphrase can be found, it opens again. If it can't, the data in that file is gone; data your app syncs can be downloaded again into a new database (delete the old file, or use a new `dbName`).

**Does it make the app slower?** Without a key, the encryption build runs the same SQLite, and our tests show it keeps the default build's behavior. With a key, every page read from and written to disk is decrypted or encrypted and authenticated, which costs some CPU. Opening an encrypted database also derives the key from the passphrase (PBKDF2, 256,000 iterations), a one-time cost at launch. We haven't published benchmarks yet: measure on the slowest device you support.

**Can I turn it off again?** Yes, for as long as none of your databases are encrypted. If some are, decrypt them first (`unsafe_DecryptDB()`), in a version of your app that still has the encryption build, then remove the switch.
