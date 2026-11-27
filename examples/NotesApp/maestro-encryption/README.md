# Upgrading an install to the encryption build

These flows aren't a suite of their own: `scripts/ci-notesapp-encryption-upgrade.sh` (CI jobs
`NotesApp iOS (encryption upgrade)` and `NotesApp Android (encryption upgrade)`; Windows runs the
same steps, except 10 and 11, with `../../NotesApp_windows/e2e-encryption`) runs them one by
one, switching between the plain build and the encryption build of NotesApp on the same simulator or
emulator, and checks the database file on disk between steps:

| Step | Build installed | Flow | Then, on disk |
| --- | --- | --- | --- |
| 1 | plain | `1-plain-install.yaml`: fresh install, adds "Upgrade marker" | plain SQLite header, the marker readable |
| 2 | encryption, over it | `2-opens-unencrypted.yaml`: notes kept, "Not encrypted" | unchanged |
| 3 | | `3-encrypt.yaml`: taps Encrypt, adds "After encryption" | no SQLite header, no marker anywhere in the files |
| 4 | | `4-reopens-encrypted.yaml`: cold start opens it with the passphrase | |
| 5 | plain, over it | `5-plain-refuses.yaml`: setup fails with `encryption_key_required` | file unchanged: never reset |
| 6 | encryption, over it | `4-reopens-encrypted.yaml` again: every note still there | |
| 7 | | `7-decrypt.yaml`: taps Decrypt, adds "After decryption" | plain SQLite header, the marker readable |
| 8 | plain, over it | `8-plain-opens-decrypted.yaml`: opens it with every note | plain SQLite header |
| 9 | encryption, over it | `9-turbo-sync.yaml`: Encrypt again, Delete all, then a Turbo Login first sync into the empty database (`turbo-sync-button`); a cold start shows only the server's note | no SQLite header, no marker anywhere in the files |
| 10 | (iOS) | `10-plaintext-header.yaml`: launched with the `nitromelonPlaintextHeader` argument (`encryption.plaintextHeader`, src/database.ts), the database moves to the App Groups layout; adds "With a plaintext header" (writes wait for the re-key, so it shows once it's done); a cold start opens it | SQLite's header in the first 32 bytes, encrypted after them, a salt file with 32 hex digits, the note nowhere |
| 11 | (iOS) | `11-plaintext-header-off.yaml`: launched without it, back to the usual layout; adds "Without a plaintext header"; a cold start opens it | no SQLite header, no salt file, the note nowhere |
| 12 | | `12-progress.yaml`: Add filler notes (about 135 MB, src/fillerNotes.ts), then Decrypt and Encrypt; after each, `encryption-progress` must report at least one progress update, only forward | no SQLite header |

Step 9 needs the reference sync server: the script starts it (`scripts/ci-start-sync-server.sh`, so
`yarn install` in `examples/sync-server` first). On Android it runs `adb reverse tcp:3000 tcp:3000`,
and on Windows it exempts the app from loopback isolation (`CheckNetIsolation`).

Steps 10 and 11 run on iOS only: `plaintextHeader` is for iOS App Groups, and NotesApp reads the
launch argument through React Native's iOS-only `Settings`. The simulator can't show the problem
the layout solves (iOS ending a suspended app that holds a lock on a database in an App Group); the
steps check that the database moves into the layout and back on a real iOS file system, and native
tests cover the layout itself on every platform.

Step 12 adds the filler with one SQL statement, which doesn't notify the list: the count in the
subtitle grows on the next launch. It comes last because adding a note re-ranks every note.

After every step, the script also fails if `unsafe_DecryptDB()`'s copy
(`nitromelon-example.db-nitromelon-decrypted`) is in the data folder: decrypt renames it over the
database when it's done, so one left behind is a leftover plain copy of an encrypted database.

Each flow can run twice in a row (the script retries one when Maestro's driver dies), so none of
them assumes it's the first run.

Locally, with both builds (`NITROMELONDB_ENCRYPTION=1` at `pod install`, or for the Gradle build,
for the encryption one):

```bash
# a booted simulator (scripts/ci-notesapp-ios-build.sh makes the zips)
bash ../../scripts/ci-notesapp-encryption-upgrade.sh ios NotesApp.app.zip NotesApp-encryption.app.zip
# one running emulator whose image allows `adb root` (not a Google Play image), the APKs built for
# its ABI (NOTESAPP_ANDROID_ARCHS=arm64-v8a bash scripts/ci-notesapp-android-build.sh <name>.apk)
bash ../../scripts/ci-notesapp-encryption-upgrade.sh android notesapp-release.apk notesapp-release-encryption.apk
```
