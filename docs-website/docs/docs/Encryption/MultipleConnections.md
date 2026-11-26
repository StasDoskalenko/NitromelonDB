---
title: 'More than one connection'
sidebar_label: 'More than one connection'
hide_title: true
description: 'Encryption with iOS app extensions, widgets and second adapters: shared passphrases, re-keying while others are open, and a plaintext header for iOS App Groups.'
---

# More than one connection

Every `SQLiteAdapter` opens its own connection to the file. Most apps have one, and need nothing from this section. You have more than one if:

- **an iOS app extension or widget** opens the same database through an App Group ([Sharing database across targets](../Advanced/SharingDatabaseAcrossTargets.md)): each target is its own process with its own connection,
- **your app creates a second adapter** for the same `dbName`, e.g. in an Android Headless JS task or a background task. These run in your app's process: import the `Database` your app already has instead of making another one.

What changes with encryption:

- **Every connection needs the passphrase.** Each target needs the encryption build (on iOS the switch is read when the pods are installed, so every target that links NitromelonDB gets it), and has to read the same passphrase. Keep it where all of them can: on iOS, a Keychain item in a shared access group (the Keychain Sharing capability on every target, and the `accessGroup` option of `expo-secure-store` or `react-native-keychain`). Extensions often run while the device is locked, so use `AFTER_FIRST_UNLOCK` (see [Where to keep the passphrase](./Passphrase.md#where-to-keep-the-passphrase)). Pass `passphrase` as a function that reads it, so a target always opens with the current one.
- **Encrypting, changing the passphrase and decrypting wait for the others to close.** `unsafe_EncryptDB()` and `unsafe_DecryptDB()` first take the database out of WAL mode, which SQLite only allows when no other connection has the file open. If one does, they wait up to 5 seconds, then reject with `rekey_failed` and change nothing: the file keeps its state and its passphrase, and both connections carry on. Run them when the others aren't open (an extension that is running keeps its connection until its process ends), and try again later if they reject. We test this for all three operations.
- **Afterwards, the others need the new passphrase.** A connection opened after a change with the old passphrase fails with `encryption_key_invalid`, and doesn't touch the file. Replace the shared Keychain item as soon as the change has finished, not before: until then the file still has the old passphrase. Keep the new one in its own item during the change, as in [Log out](./ChangePassphrase.md#log-out-wipe-the-data-and-change-the-passphrase).
- **Opening while a change runs.** A target that opens the database while it's being encrypted, re-keyed or decrypted waits for it, and can then fail to read the file (it read the passphrase, or the lack of one, from before the change). Opening it again works.
- **iOS App Groups: turn on `plaintextHeader`.** Otherwise iOS kills the app each time it goes to the background with the database open. See [below](#ios-app-groups-a-plaintext-header).
- **`usesExclusiveLocking: true`** makes the first connection that uses the file keep it locked until it closes. A second connection can then neither read nor write, so it doesn't work with extensions or a second adapter at all. With it, encrypting and decrypting never meet another connection.

## iOS App Groups: a plaintext header

iOS terminates an app that is suspended while it holds a lock on a database in a shared App Group container, unless it can tell that the file is a SQLite database. It tells from the file's first bytes. An encrypted database's first bytes are random, so without a fix, an app that keeps one open there is killed each time it goes to the background. [SQLCipher](https://www.zetetic.net/sqlcipher/sqlcipher-api/#cipher_plaintext_header_size) and [SQLite3 Multiple Ciphers](https://utelle.github.io/SQLite3MultipleCiphers/docs/faq/faq_overview) both document this, and the fix: a plaintext header.

```js
const adapter = new SQLiteAdapter({
  schema,
  dbName: `${appGroupPath}/watermelon.db`,
  encryption: {
    passphrase: getPassphrase, // from a Keychain item in a shared access group
    plaintextHeader: true,
  },
})
```

Use the same option in every target that opens the database.

What it does:

- **The first 32 bytes of the file stay plain**: SQLite's header (the text "SQLite format 3", the page size, the page count). iOS reads them and leaves the app alone. Everything else is encrypted as before, in SQLCipher 4's format. 32 is the size SQLCipher documents for iOS.
- **The key's salt moves to a file next to the database**, `<database>-nitromelon-salt`, because without a plaintext header it's stored in those first bytes. The salt isn't secret, so a file next to the database protects it exactly as well as before (SQLCipher's docs leave it to the app to store the salt; NitromelonDB does it for you). But the database can't be opened without it, so keep the two together. Back them up, copy them and delete them together. A database whose salt file is missing fails with `encryption_salt_missing`, and NitromelonDB leaves it alone; putting the salt file back makes it open again.
- **New databases are created with it.** An encrypted database without a plaintext header (from before you turned the option on) is re-keyed into the new layout when it's opened, with the passphrase it has. It's the same operation as [changing the passphrase](./ChangePassphrase.md), with the same `encryption.events` (`operation: 'rekey'`) and progress, and calls made in the meantime wait. If it fails (for example, another target has the file open), the database keeps its layout and works as before, and the next launch tries again. Turning the option off moves the database back the same way, and deletes the salt file.
- **Encrypting, changing the passphrase and decrypting** keep the salt file right: it's written before a re-key depends on it, and deleted once the database doesn't need it. Killing the app at any point leaves a database that opens, in the old layout or the new one. We test this for every change of layout, like for every re-key (see [What we test](./HowItWorks.md#what-we-test)).
- **Node and Electron** don't support it: the option throws `encryption_unavailable` there, and so does opening a database that has a plaintext header. To move one to Node, open it once in the app without `plaintextHeader`.

Without the option, keep an encrypted database in the app's own container rather than the App Group's.
