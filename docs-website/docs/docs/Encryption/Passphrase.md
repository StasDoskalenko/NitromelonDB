---
title: 'Open an encrypted database'
sidebar_label: 'Open with a passphrase'
hide_title: true
description: 'Give SQLiteAdapter a passphrase, what happens when it is missing or wrong, and where to keep it (Keychain, Keystore).'
---

# Open an encrypted database

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
- **Errors never touch the file.** A wrong passphrase, a missing one, or a plain database where an encrypted one was expected fails setup with an [error code](./Troubleshooting.md#errors). NitromelonDB does not reset or recreate the database in any of these cases, not even through `unsafeResetDatabase()`.

Setup errors come out where they always do: `adapter.initializingPromise` and `database.readyPromise` reject, and `onSetUpError` is called.

## Where to keep the passphrase

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
