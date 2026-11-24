# Upgrading an install to the encryption build (Windows)

The Windows version of [`../../NotesApp/maestro-encryption/`](../../NotesApp/maestro-encryption/README.md):
one WinAppDriver test per Maestro flow, with the same names and steps, using `../e2e/helpers.js`.
Not a suite of its own: `scripts/ci-notesapp-encryption-upgrade.sh windows` (CI job
`Windows NotesApp (encryption upgrade)`) runs them one at a time, switching between the plain and
the encryption build, and checks the database file in `LocalState` between steps.
`jest.e2e-encryption.config.js` is `jest.e2e.config.js` without the LocalState wipe, since each step
runs against the database the previous one left.

Locally, from the repo root, with both builds' app folders saved (each build's
`windows/NitromelonWindows.Package/bin/x64/Release/AppX`, copied after building it, plain without
and encryption with `NITROMELONDB_ENCRYPTION=1`):

```bash
bash scripts/ci-notesapp-encryption-upgrade.sh windows <plain AppX folder> <encryption AppX folder>
```

It removes the installed `NitromelonWindows` package and its data first.
