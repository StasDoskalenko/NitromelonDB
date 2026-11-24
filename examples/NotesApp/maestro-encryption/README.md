# Upgrading an install to the encryption build

These flows aren't a suite of their own: `scripts/ci-notesapp-encryption-upgrade.sh` (CI jobs
`NotesApp iOS (encryption upgrade)` and `NotesApp Android (encryption upgrade)`) runs them one by
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
