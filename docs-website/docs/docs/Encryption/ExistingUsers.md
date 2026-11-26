---
title: 'Add encryption to an app that already has users'
sidebar_label: 'Existing users'
hide_title: true
description: 'Open plain databases from earlier app versions and encrypt them in place with unsafe_EncryptDB(), safely even if the app is killed, and check the encryption state.'
---

# Add encryption to an app that already has users

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
      onProgress: ({ progress }) => updateProgress(progress), // 0 to 1
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
- **Takes a while on a big database**: it rewrites every page. `events.onStart` tells you the size (`byteSize`), so you can decide to show something, and `events.onProgress` how far it has come (see [Show progress](#show-progress)). While it runs, it can need free disk space of up to about three times the database's size.
- **Survives being killed.** If the app is killed in the middle (by the user, or by the OS in the background), the database opens afterwards either as it was (plain) or fully encrypted, never half-way: on the next launch, NitromelonDB finishes rolling back the interrupted encryption before it opens the file. If it's still plain, `isDBEncrypted()` says so, and your code encrypts it again. We test this by killing the process at points throughout the encryption, re-key and decryption, and by crashing it exactly at its commit, and check that every database opens, complete, with either the old or the new passphrase.
- **Save the passphrase first.** From then on the database opens only with it.

New installs don't need any of this: with a passphrase, a new database is created encrypted. `isDBEncrypted()` is already `true` for them.

Keep `ifUnencrypted: 'open'` for as long as users may still update from a version without encryption. Afterwards you can remove it, so that a plain database (which shouldn't exist any more) is an error.

## Show progress

`encryption.events` tells you about every `unsafe_EncryptDB()` and `unsafe_DecryptDB()`:

| Event        | When                                                   | Gets                                                                         |
| ------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `onStart`    | before the file changes                                | `operation` (`'encrypt'`, `'rekey'` or `'decrypt'`), `pageCount`, `byteSize` |
| `onProgress` | while it runs, about every 200 ms when it has moved    | `operation`, `progress` from 0 to 1                                          |
| `onSuccess`  | when it's done                                         | `operation`, `durationMs`                                                    |
| `onError`    | when it failed (the database keeps its previous state) | the error, with `error.code`                                                 |

`progress` is an estimate. SQLite doesn't report how far a re-key has come, so NitromelonDB works it out from what has been written so far: the size of the decrypted copy when decrypting, the size of the rollback journal (which gets every page before it's rewritten) when changing the passphrase, and when encrypting, first the pages of the encrypted copy SQLite builds, then the journal. It only moves forward and ends close to 1, which is what a progress bar needs. Our native tests poll it from another thread during each operation and check exactly that.

On iOS, Android and Windows the work runs on a background thread, and `onProgress` comes on the JS thread. On Node and Electron, SQLite runs on the JS thread, so nothing can run until it's done, and `onProgress` isn't called.

In React, the [`useEncryption`](../Hooks.md#useencryption--encryption-state-and-progress) hook gives you the same as state, with `encrypt()` and `decrypt()`:

```js
import { useEncryption } from 'nitromelondb/react'

function EncryptionSettings() {
  const { state, operation, progress, error, encrypt } = useEncryption()
  if (operation) {
    return <ProgressBar value={progress} />
  }
  return (
    <>
      {error ? <Text>{error.message}</Text> : null}
      <Button
        title="Encrypt"
        disabled={state !== 'unencrypted'}
        onPress={async () => encrypt(await getPassphrase())}
      />
    </>
  )
}
```

`state` is `'loading'`, `'encrypted'`, `'unencrypted'`, or `'unavailable'` when the adapter can't encrypt (no `encryption` option, or LokiJS). It follows operations started anywhere, not only from the hook. You can also subscribe without React: `adapter.subscribeToEncryptionEvents(events)` takes the same events and returns a function that unsubscribes.

## Check the state

| Question                                          | API                                                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Is this build able to encrypt?                    | `SQLiteAdapter.isEncryptionAvailable()`: `true` in the encryption build                                                 |
| Is the database I have open encrypted?            | `await database.isDBEncrypted()`. Waits for setup. The definitive answer.                                               |
| Is the file on disk encrypted, before opening it? | `await SQLiteAdapter.getDatabaseEncryptionState(dbName)`: `'encrypted'`, `'unencrypted'` or `'missing'` (a new install) |

`getDatabaseEncryptionState()` only reads the first bytes of the file, so it's cheap and needs no passphrase. Its `'unencrypted'` is certain (a plain SQLite file starts with `SQLite format 3`). Its `'encrypted'` really means "not a plain SQLite file": a damaged file looks the same. Only opening it with the passphrase proves it's encrypted.
