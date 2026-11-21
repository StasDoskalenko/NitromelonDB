---
title: Encryption
hide_title: true
description: "Opt-in database encryption for iOS, Android and Windows: why it is a build switch, how to turn it on, how to check it worked, and what it means for App Store export compliance."
---

# Encryption

NitromelonDB can encrypt the SQLite database on disk, in the same file format as [SQLCipher](https://www.zetetic.net/sqlcipher/) 4. Encryption is **opt-in, at build time**: apps that don't ask for it ship exactly what they shipped before, with no cryptography from NitromelonDB in them.

:::note Status: the encryption build is here, the passphrase API comes next
Encryption is landing in stages ([#60](https://github.com/StasDoskalenko/NitromelonDB/issues/60)). This release adds the **encryption build**: the switch described on this page, which compiles a SQLite that can encrypt. The API to give it a passphrase, and to encrypt, re-key or decrypt an existing database, comes in a following release.

So turning the switch on today **does not encrypt anything yet**. Your databases stay plain SQLite files. What you can do now is turn it on in a branch and sort out the build, the app size and the App Store paperwork before the API arrives.
:::

## At a glance

|  | Default build | Encryption build |
| --- | --- | --- |
| How to get it | nothing to do | `"nitromelondb": { "encryption": true }` in your app's `package.json` |
| SQLite on iOS | the system `libsqlite3` | bundled [SQLite3 Multiple Ciphers](https://github.com/utelle/SQLite3MultipleCiphers) (built on SQLite 3.54.1) |
| SQLite on Android and Windows | bundled SQLite 3.54.1 | bundled SQLite3 Multiple Ciphers (built on SQLite 3.54.1) |
| Can encrypt a database | no | yes (once the passphrase API ships) |
| Cryptography in your app from NitromelonDB | none | AES-256, HMAC-SHA512, PBKDF2 (all standard) |
| App size (per arm64 slice) | unchanged | about +1.2 MB on iOS, about +110 KB on Android |
| Databases without a key | plain SQLite files | plain SQLite files, byte for byte the same |

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

All builds of one app should agree. Once the passphrase API ships and a database has been encrypted, an app built without encryption can't open it.

## Check that it worked

**In the build output**, the encryption build announces itself:

| Platform | Where | Line |
| --- | --- | --- |
| iOS | `pod install` output | `[NitromelonDB] SQLite encryption build (SQLite3 Multiple Ciphers)` |
| Android | Gradle output | `NitromelonDB: SQLite encryption build (SQLite3 Multiple Ciphers)` |
| Windows | MSBuild output | `NitromelonDB: SQLite encryption build (SQLite3 Multiple Ciphers)` |

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

This is for checking your setup in development. Don't ship it as a feature check: the passphrase API will report problems itself, loudly.

## What changes in the encryption build

**The engine.** The encryption build compiles [SQLite3 Multiple Ciphers](https://github.com/utelle/SQLite3MultipleCiphers) (sqlite3mc, MIT licensed) on every platform. It is unmodified SQLite plus an encryption layer, and NitromelonDB's copy is always built on the same SQLite version as the default build (3.54.1 today), so switching between the two never changes how your SQL behaves on Android and Windows.

**On iOS** it replaces the system SQLite. To keep behavior the same, it is built with the settings of Apple's SQLite that an app can notice:

- WAL commits without `fsync` (`synchronous = NORMAL`), and a full sync at checkpoints, so writes are as fast as before,
- full-text search (FTS3, FTS4, FTS5), R*Tree and math functions, for anyone using them through `Q.unsafeSqlQuery`,
- up to 500,000 bound variables per statement.

**Your existing databases.** With no key set, the encryption build reads and writes ordinary SQLite files, byte for byte the same as before. Turning the switch on doesn't touch a single database, and turning it off again is safe for as long as none of your databases has been encrypted.

**The format.** Encrypted databases (once the passphrase API ships) use the SQLCipher 4 format with its defaults: AES-256-CBC, HMAC-SHA512 page authentication, and keys derived with PBKDF2-HMAC-SHA512 over 256,000 iterations. Only this one cipher is compiled in. Any SQLCipher 4 tool can open these files with the key, which helps when you debug: the `sqlcipher` command-line shell, or [DB Browser for SQLite](https://sqlitebrowser.org/) with SQLCipher support.

**Other SQLite libraries in your app.** The encryption build hides all of its SQLite symbols. An app can also contain `expo-sqlite`, `op-sqlite`, the SQLCipher pod or the system SQLite without duplicate-symbol errors, and without one library quietly running on another's SQLite. One rule: two SQLite libraries in one app must not open the **same database file**, because they don't share file locks.

## App Store and export compliance

:::danger Not legal advice
This section explains what we know and where to look. Export rules differ by country and change over time, and your obligations depend on your app and where you distribute it. Check Apple's current guidance, and ask someone qualified if you are unsure.
:::

**The App Store does not forbid encryption.** Many approved apps bundle their own cryptography (SQLCipher, Realm's encrypted databases, Signal, anything built on OpenSSL). What Apple asks about is **export compliance**: when you upload an app, you export it from the US, and an app that contains encryption is subject to US export rules (and to the import rules of the countries you distribute in). So App Store Connect asks about encryption for every new version, and the answer covers your app **"including any third-party libraries it links against"**, in Apple's words. That sentence is the reason the cipher is opt-in.

**With the default build**, NitromelonDB adds no cryptography to your app. Whatever you answer Apple today stays correct.

**With the encryption build**, your app contains encryption that isn't part of iOS: NitromelonDB's bundled AES-256, HMAC-SHA512 and PBKDF2-HMAC-SHA512. These are industry-standard algorithms (published, and accepted by standards bodies), used to protect your app's own data at rest.

Apple's [reference table](https://developer.apple.com/help/app-store-connect/reference/export-compliance-documentation-for-encryption) sorts apps into three cases:

| Your app uses | Documentation Apple asks for |
| --- | --- |
| only encryption within Apple's operating system (HTTPS with `URLSession`, CommonCrypto, the Keychain) | none |
| **an industry-standard algorithm not provided by the operating system**: the encryption build | a French encryption declaration, **only if** you distribute in France |
| proprietary algorithms not accepted by standards bodies | a US classification (CCATS), plus the French declaration if you distribute in France |

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

The following releases add the passphrase API, roughly in this order. The design is in the [encryption plan](https://github.com/StasDoskalenko/NitromelonDB/blob/master/docs/plans/sqlcipher-encryption.md).

1. **Open with a key**: an `encryption: { passphrase }` option on `SQLiteAdapter`. The passphrase can come from an async function (Keychain, biometric prompt, your server), and NitromelonDB waits for it before it opens the file. A wrong key, a missing key, or a passphrase given to an app built without the encryption switch fails with a clear error. It never silently opens a plaintext database, and it never resets your data.
2. **Encrypt an existing database in place**, so apps that already have users can turn encryption on without losing or re-downloading anything. The same call changes the key or decrypts. While it runs, writes wait, and progress events let you show a spinner.
3. **Node and Electron** support through `better-sqlite3-multiple-ciphers`.

The web (LokiJS, wa-sqlite) is not part of this work.

## Troubleshooting

**I turned it on, but the build line doesn't show up.**

- iOS: run `pod install` again (Expo: `npx expo prebuild --clean`). CocoaPods only reads the switch while it installs.
- Check which `package.json` the build sees: the first one above `ios/`, `android/` or the Windows solution. In a monorepo that is usually the app package's, not the workspace root.
- Check that `NITROMELONDB_ENCRYPTION` isn't set to `0` in your shell or on CI. It wins over `package.json`.

**The build fails with `must be true or false`.** The value in `package.json` must be a JSON boolean, `true` or `false`, not `"true"`. `NITROMELONDB_ENCRYPTION` accepts `1`, `0`, `true` and `false`.

**Duplicate symbols, or `redefinition of sqlite3_mem_methods`, with another SQLite library.** The encryption build hides its SQLite symbols, so it shouldn't cause these. If you see them, make sure the new pods were installed (`pod install`, or a clean prebuild), and [open an issue](https://github.com/StasDoskalenko/NitromelonDB/issues) with the full error.

**Does it make the app slower?** Without a key, the encryption build runs the same SQLite, and our tests show it keeps the default build's behavior. We haven't published benchmarks yet. Encrypted databases will cost some CPU per page read and written, and we will measure that when the passphrase API ships.

**Can I turn it off again?** Yes, for as long as none of your databases has been encrypted. Once the passphrase API ships and a database has been encrypted, decrypt it first (with the API), then remove the switch.
