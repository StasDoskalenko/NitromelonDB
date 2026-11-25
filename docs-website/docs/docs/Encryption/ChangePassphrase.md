---
title: 'Change the passphrase, decrypt, log out'
sidebar_label: 'Change, decrypt, log out'
hide_title: true
description: 'Change the passphrase or decrypt a database, and log a user out by wiping the data and changing the passphrase, without losing it if the app is killed.'
---

# Change the passphrase, decrypt, log out

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

Both run in a writer and are safe to kill, like [encrypting](./ExistingUsers.md):

- **Changing the passphrase** works in place. If it's cut off, the database still has the **old** passphrase. So save the new one before you call it, but keep the old one until the call has finished; on a launch after an interrupted change, if setup fails with `encryption_key_invalid`, open with the old passphrase (the error message says so too) and change it again.
- **Decrypting** writes a decrypted copy next to the database and then replaces the file with it, in one step. It needs free space for the copy. If it's cut off before that step, the database is untouched and still encrypted (the leftover copy is deleted on the next launch); after it, the database is plain. After decrypting, the next launch needs `ifUnencrypted: 'open'` (or no `encryption` option at all) to open the plain file.

## Log out: wipe the data and change the passphrase

`unsafeResetDatabase()` keeps an encrypted database encrypted, with the same passphrase, like every encrypted store (SQLCipher, Realm, Room with SQLCipher): the passphrase belongs to your adapter's settings, not to the file. When the data belongs to one user who logs out, also **change the passphrase** and delete the old one, as SQLCipher's maintainers advise ("delete the database file at the time that you clear the old encryption key, or before generating a new one", [Zetetic forum](https://discuss.zetetic.net/t/sqlcipher-cannot-build-database-after-restarting-app/4550)). `SecureStore`, `PASSPHRASE_KEY` and the random passphrase are the ones from [Where to keep the passphrase](./Passphrase.md#where-to-keep-the-passphrase):

```js
const NEW_PASSPHRASE_KEY = 'database-passphrase-new'
const keychainOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }

async function logOut() {
  const newPassphrase = makeRandomPassphrase() // as in getPassphrase()
  // Save the new passphrase before the change, next to the old one (see "Changing the passphrase" above)
  await SecureStore.setItemAsync(NEW_PASSPHRASE_KEY, newPassphrase, keychainOptions)
  await database.write(async () => {
    await database.unsafeResetDatabase()
    // Cheap: the database is empty now
    await database.unsafe_EncryptDB(newPassphrase)
  })
  // Only now replace the old one
  await SecureStore.setItemAsync(PASSPHRASE_KEY, newPassphrase, keychainOptions)
  await SecureStore.deleteItemAsync(NEW_PASSPHRASE_KEY)
}
```

If the app is killed during a log-out, `NEW_PASSPHRASE_KEY` still has a value at the next launch. What to do depends on where it stopped:

- **Before the change finished:** the database still has the old passphrase, and may still have the old user's data (if the reset didn't finish either). Setup succeeds, so nothing fails to tell you: when `NEW_PASSPHRASE_KEY` has a value that differs from `PASSPHRASE_KEY`, run `logOut()` again before anything else uses the database.
- **After the change, before the last two lines:** the database has the new passphrase, which only `NEW_PASSPHRASE_KEY` holds. Setup fails with `encryption_key_invalid`: open with `NEW_PASSPHRASE_KEY`, then finish the last two lines. Without that item, the new passphrase would be lost, and the database couldn't be opened again.
- **Between the last two lines:** both items hold the new passphrase. Delete `NEW_PASSPHRASE_KEY`.

With app extensions ([More than one connection](./MultipleConnections.md)), keep `NEW_PASSPHRASE_KEY` in the same shared access group as `PASSPHRASE_KEY` (add `accessGroup` to `keychainOptions`), so a target that opens the database after a cut-off log-out can read it too.

Why change it at all: a reset removes the old data from the file, but flash storage can keep old copies of its blocks, and leftovers of the database's journal can outlive it. Those are still encrypted, with the passphrase your app keeps for the next user. Once that passphrase is replaced, nothing can decrypt them. This is what NIST calls a cryptographic erase ([SP 800-88](https://csrc.nist.gov/glossary/term/cryptographic_erase)).
