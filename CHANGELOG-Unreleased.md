### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal

- NotesApp web: a Playwright test where two devices on wa-sqlite (two browser profiles) sync through the reference sync server: first syncs in both directions, a note reaching the other device, both syncing at once (a rejected push resolved by syncing again), and synced data surviving a reload. The sync server gets an optional `SYNC_SERVER_CORS_ORIGIN` so web apps can call it (`yarn start:notes-app` allows any origin)
- CI: the Android flashlight benchmark adjusts CPU, FPS and score for the CI machine's speed, like the iOS benchmark does with WatermelonDB: a fixed NotesApp build (v0.32.0, built once and cached) runs in turns with each commit's, and how it compares with its usual values is that job's machine factor. The PR comment compares the adjusted values with the median and range of master's last 10 runs (🟢 better, 🟡 within range, 🔴 clearly worse, ⬆️ / ⬇️ for the direction), and the performance page charts them (once enough runs have the reference)
