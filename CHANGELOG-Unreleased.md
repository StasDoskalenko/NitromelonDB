### Highlights

### BREAKING CHANGES

### Deprecations

### New features

- **Paginated pulls** (#50). `pullChanges()` can return a `nextCursor`; `synchronize()` then calls it again with `cursor` until a page comes without one. Each page is applied in its own write (one page in memory at a time), `lastPulledAt` only moves after the last page, local changes are pushed once at the end, and a sync that stops halfway continues from the saved cursor next time (or starts over after an app update changed the schema). Nothing changes for servers that don't return `nextCursor` (`null`, `false` and `''` also mean the last page). Development builds warn if `pullChanges()` returns `experimentalHasMore` (from an unreleased WatermelonDB pull request), which isn't supported. The Sync docs describe the client side, the rules for the server, and troubleshooting, and the example sync server implements it (`SYNC_SERVER_PAGE_SIZE`, keyset pages by `(last_modified, id)` over a fixed snapshot timestamp)
### Fixes

### Performance

### Changes

- Sync: if your `pullChanges()` already returns a field named `nextCursor` (for example, your server's own paginated responses passed through), a string, number, object or array there now makes `synchronize()` fetch the next page itself. Check it before upgrading. `null`, `false`, `''` or no field keep working as before. Also, `log.newLastPulledAt` is now set once the pulled changes are applied, not before
### Internal

- Sync end-to-end tests for paginated pulls on SQLite and LokiJS: first and incremental syncs in pages, server changes and local edits between pages, an interrupted pull continuing from its cursor, an app update in the middle of one, a push conflict with a change made during the pull, and batched pulls. The random convergence test also runs against a server sending pages of 7, with pulls interrupted halfway
- CI: the Android flashlight benchmark adjusts CPU, FPS and score for the CI machine's speed, like the iOS benchmark does with WatermelonDB: a fixed NotesApp build (v0.32.0, built once and cached) runs in turns with each commit's, and how it compares with its usual values is that job's machine factor. The PR comment compares the adjusted values with the median and range of master's last 10 runs (🟢 better, 🟡 within range, 🔴 clearly worse, ⬆️ / ⬇️ for the direction), and the performance page charts them (once enough runs have the reference)
