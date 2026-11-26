---
name: nitromelondb-encryption
description: >
  Use when adding database encryption to an app that uses NitromelonDB
  (nitromelondb), or checking how it's done: decides whether the app needs
  it, turns on the encryption build, keeps a random passphrase in the
  Keychain / Keystore, opens the database with it, encrypts existing users'
  databases in place with progress (useEncryption), handles setup errors
  without ever resetting, changes the passphrase on logout, sets up iOS app
  extensions and App Groups (plaintextHeader), and verifies the file on disk.
  Invoke with `/nitromelondb-encryption`.
license: MIT
metadata:
  author: StasDoskalenko
  version: 0.1.0
---

# Encrypt a NitromelonDB database

Encrypt the app's local database (SQLCipher 4 format), keep the passphrase safe, and leave existing users' data intact.

References (plain Markdown): [Encryption](https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/Intro.md), [Setup](https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/Setup.md), [Open with a passphrase](https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/Passphrase.md), [Existing users](https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/ExistingUsers.md), [Changing the passphrase](https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/ChangePassphrase.md), [More than one connection](https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/MultipleConnections.md), [Troubleshooting](https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/Troubleshooting.md). Full index: https://stasdoskalenko.github.io/NitromelonDB/llms.txt

## Rules

- **Never put a passphrase in source code, the JS bundle, `app.json`, `.env` files or logs.** Anyone can read those. Generate it on the device.
- **Never reset or delete the database because of an encryption error.** `encryption_key_invalid`, `encryption_key_required`, `database_not_encrypted` and `encryption_salt_missing` mean the data is intact but can't be opened as asked. Resetting loses it for good. NitromelonDB never resets in these cases; the app's code mustn't either.
- **Ask before anything that changes users' data on disk**: encrypting existing databases, decrypting, changing the passphrase, turning on `plaintextHeader` for a database that's already encrypted.
- Encryption is SQLite only: iOS, Android, Windows, and Node / Electron with `better-sqlite3-multiple-ciphers`. LokiJS and the web refuse the option. If the app only runs there, stop and say so.

## Procedure

### 1. Decide whether the app needs it

Read [What encryption protects against](https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/Intro.md) and tell the user, in two or three sentences, what it adds for this app. iOS and Android already encrypt app storage while the device is locked. Database encryption mainly adds protection on an unlocked, rooted or jailbroken device, in backups, against other apps that can read the files, and for audits or contracts that require application-level encryption. It does not protect against code running in the app, or a passphrase kept somewhere readable. If none of these apply, say so and ask whether to continue.

Also mention that the encryption build makes the iOS app contain cryptography of its own, which changes the App Store export-compliance answers: [App Store and export compliance](https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/ExportCompliance.md).

### 2. Map the app

Find and read:

- `package.json`: the `nitromelondb` version (encryption needs 0.33 or later), Expo or bare React Native, whether a `"nitromelondb"` key exists.
- Every `new SQLiteAdapter({ ... })`, its `dbName`, and whether it's in an App Group container (iOS extensions, widgets: [Sharing database across targets](https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/SharingDatabaseAcrossTargets.md)).
- How the app has shipped so far: does it have users with a plain database? (Any release before this change means yes.)
- The secure storage library, if any: `expo-secure-store`, `react-native-keychain`.
- `onSetUpError`, and any code that calls `unsafeResetDatabase()` on errors.
- The logout flow, if there is one.

### 3. Turn on the encryption build

Add to the app's own `package.json` (a JSON boolean, not `"true"`):

```json
"nitromelondb": { "encryption": true }
```

Then rebuild the native app. On iOS, run `pod install` again (the switch is read there); with Expo, `npx expo prebuild` or a new EAS build. There is no Expo config plugin option for this: passing `encryption` to the `nitromelondb` plugin fails on purpose. On Node and Electron, install `better-sqlite3-multiple-ciphers` instead. Details per platform: [Setup](https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/Setup.md).

Check that it took effect: the build log has a line with `SQLite encryption build`, and `SQLiteAdapter.isEncryptionAvailable()` returns `true` at runtime.

### 4. Keep the passphrase in the Keychain / Keystore

Generate a random passphrase on first launch and keep it in secure storage, readable after the first unlock (background work may need it while the device is locked). Copy `getPassphrase()` from [Where to keep the passphrase](https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/Passphrase.md#where-to-keep-the-passphrase). It only makes a new passphrase when there's no encrypted database yet, because a new one wouldn't open an existing database. Install `expo-secure-store` and `expo-crypto` (Expo) or `react-native-keychain` (bare) if the app has neither.

Ask the user about two choices that depend on the app, and explain each in one sentence: whether the passphrase should survive a restore to a new device (`*_THIS_DEVICE_ONLY` or not), and whether it should be derived from the user's password instead (stronger, but the database then opens only after sign-in).

### 5. Open the database with it

Pass the function, not a string, so every target reads the current passphrase:

```js
const adapter = new SQLiteAdapter({
  schema,
  migrations,
  encryption: {
    passphrase: getPassphrase,
    // Only if the app has users with a plain database (step 6)
    ifUnencrypted: 'open',
    // Only if the database is in an iOS App Group container (step 9)
    plaintextHeader: true,
  },
  onSetUpError: (error) => {
    // error.code: see the table below. Report it; never reset because of it
  },
})
```

A new database is created encrypted. Database calls made while the passphrase is loading wait for it.

Handle setup errors by `error.code` ([Errors](https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/Troubleshooting.md#errors)):

| `error.code`              | What the app should do                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `encryption_unavailable`  | A build without the switch: fix the build (step 3).                                                                       |
| `encryption_key_invalid`  | Wrong passphrase: try the other one if a passphrase change was cut off (step 8), otherwise report it. The file is intact. |
| `encryption_key_required` | The file is encrypted but no passphrase was given: a code path without `encryption`.                                      |
| `database_not_encrypted`  | A plain database without `ifUnencrypted: 'open'` (step 6).                                                                |
| `encryption_salt_missing` | `plaintextHeader` database without its salt file next to it: the files were separated.                                    |
| `rekey_failed`            | Encrypting, re-keying or decrypting failed (disk full, another connection open). Nothing changed: try again later.        |

If the app already resets the database in `onSetUpError` or on any open error, make it skip these codes, and show the user why.

### 6. Existing users: encrypt in place

Skip this step for an app that hasn't shipped. Otherwise add `ifUnencrypted: 'open'` (step 5), and encrypt once after launch, inside a writer. It keeps every record, survives being killed, and needs free space of up to three times the database size. Show progress for big databases.

With React, use the hook ([useEncryption](https://stasdoskalenko.github.io/NitromelonDB/docs/Hooks.md#useencryption--encryption-state-and-progress)):

```js
import { useEncryption } from 'nitromelondb/hooks'

function EncryptOnFirstLaunch() {
  const { state, operation, progress, encrypt } = useEncryption()
  useEffect(() => {
    if (state === 'unencrypted') {
      getPassphrase().then(encrypt).catch(reportError)
    }
  }, [state])
  return operation ? <ProgressBar value={progress} /> : null
}
```

Without React: `database.write(() => database.unsafe_EncryptDB(await getPassphrase()))`, with `encryption.events` (`onStart`, `onProgress`, `onSuccess`, `onError`) for progress. Save the passphrase before calling it. Keep `ifUnencrypted: 'open'` for as long as users may update from a version without encryption. See [Existing users](https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/ExistingUsers.md).

### 7. Background work

Headless JS, background fetch and push handlers open the same database. They need the same `encryption` option and must be able to read the passphrase while the device is locked (`AFTER_FIRST_UNLOCK`). Prefer importing the app's existing `Database` over creating a second adapter.

### 8. Logout

`unsafeResetDatabase()` keeps the database encrypted with the same passphrase. If the data belongs to one user, change the passphrase on logout as well: copy `logOut()` from [Log out](https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/ChangePassphrase.md#log-out-wipe-the-data-and-change-the-passphrase). It saves the new passphrase before the change and only replaces the old one after it. Also handle a log-out that was cut off at the next launch, as that section describes.

### 9. iOS app extensions and App Groups

Skip unless a widget, extension or App Group container is involved. Then ([More than one connection](https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/MultipleConnections.md)):

- Every target gets the encryption build and the same `encryption` option.
- Keep the passphrase in a Keychain item in a shared access group (the Keychain Sharing capability on every target, `accessGroup` in the secure storage call).
- **Pass `plaintextHeader: true` in every target** when the database is in the App Group container. Without it, iOS kills the app each time it's suspended with the database open. NitromelonDB keeps the key's salt in `<database>-nitromelon-salt` next to the database: any code that copies, backs up or deletes the database file must handle that file too. An existing encrypted database is moved to the new layout automatically when it's opened.
- Encrypting, changing the passphrase and decrypting wait for the other targets' connections to close, and fail with `rekey_failed` (changing nothing) if they don't.

### 10. Verify

- Build and launch the app. `await database.isDBEncrypted()` is `true`, and `SQLiteAdapter.isEncryptionAvailable()` is `true`.
- Look at the file on a simulator or emulator. Without `plaintextHeader`, its first 16 bytes are not `SQLite format 3`. With it, they are, but text from a record (search for a known note title with `grep -c`) isn't in the file.
- Test the upgrade path if the app has users: install the last release, add data, install the new build over it, launch. The data is there and the database ends up encrypted.
- Relaunch: it opens with the saved passphrase.
- If there's a logout, log out and in again, then relaunch.
- Run the type checker and the tests. In Jest, the adapter's default database is in memory, which can't be encrypted (`encryption_unavailable`): leave `encryption` out of the test setup, or give it a `dbName` that names a file and install `better-sqlite3-multiple-ciphers`.

Finish with a short summary: what was changed, where the passphrase lives, what the user still has to decide (device-restore behaviour, export compliance), and how to check it on a device.
