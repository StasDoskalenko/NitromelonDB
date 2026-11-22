# Upgrading an install to the encryption build

These flows aren't a suite of their own: `scripts/ci-notesapp-ios-encryption-upgrade.sh` (CI job
`NotesApp iOS (encryption upgrade)`) runs them one by one, switching between the plain build and the
encryption build of NotesApp on the same simulator, and checks the database file on disk between
steps:

| Step | Build installed | Flow | Then, on disk |
| --- | --- | --- | --- |
| 1 | plain | `1-plain-install.yaml`: fresh install, adds "Upgrade marker" | plain SQLite header, the marker readable |
| 2 | encryption, over it | `2-opens-unencrypted.yaml`: notes kept, "Not encrypted" | unchanged |
| 3 | | `3-encrypt.yaml`: taps Encrypt, adds "After encryption" | no SQLite header, no marker anywhere in the files |
| 4 | | `4-reopens-encrypted.yaml`: cold start opens it with the passphrase | |
| 5 | plain, over it | `5-plain-refuses.yaml`: setup fails with `encryption_key_required` | file unchanged: never reset |
| 6 | encryption, over it | `4-reopens-encrypted.yaml` again: every note still there | |

Each flow can run twice in a row (the script retries one when Maestro's iOS driver dies), so none of
them assumes it's the first run.

Locally, with a booted simulator and both builds (`NITROMELONDB_ENCRYPTION=1` at `pod install` for
the encryption one):

```bash
bash ../../scripts/ci-notesapp-ios-encryption-upgrade.sh NotesApp.app.zip NotesApp-encryption.app.zip
```
