### Highlights

### BREAKING CHANGES

### Deprecations

### New features

- **Paginated pulls** (#50), opt-in on both sides. Pass `paginatedPulls: true` to `synchronize()`, and have the server page only for apps that ask (`paginated=true` in the docs and examples). A page comes with a `nextCursor`, and `synchronize()` calls `pullChanges()` again with `cursor` until a page comes without one. Each page is applied in its own write (one page in memory at a time), `lastPulledAt` only moves after the last page, local changes are pushed once at the end, and a sync that stops halfway continues from the saved cursor next time (or starts over after an app update changed the schema). Without `paginatedPulls`, `nextCursor` is ignored as before, and development builds warn. They also warn about `experimentalHasMore` (from an unreleased WatermelonDB pull request), which isn't supported. The Sync docs and examples use paginated pulls by default: the example sync server pages for apps that ask (`SYNC_SERVER_PAGE_SIZE`, 1000 by default; keyset pages by `(last_modified, id)` over a fixed snapshot timestamp), and NotesApp asks

### Fixes

### Performance

### Changes

- Sync: `log.newLastPulledAt` is now set once the pulled changes are applied, not before

### Internal

- Sync end-to-end tests for paginated pulls on SQLite and LokiJS: first and incremental syncs in pages, server changes and local edits between pages, an interrupted pull continuing from its cursor, an app update in the middle of one, a push conflict with a change made during the pull, and batched pulls. The random convergence test also runs against a server sending pages of 7, with pulls interrupted halfway
- Sync end-to-end tests for a custom `conflictResolver` with an app-side retry loop (called for every pulled update, resolving on the retry after a rejected push, giving up and pushing later, never asked about deletions) and for migration syncs turned on after an app shipped (`migrationsEnabledAtVersion` later than the version a device logged in on, and the fallback when a device has no noted version). The Sync docs now spell out what a `conflictResolver` is called with and when it must mark a column as changed
- CI: the Android flashlight benchmark adjusts CPU, FPS and score for the CI machine's speed, like the iOS benchmark does with WatermelonDB: a fixed NotesApp build (v0.32.0, built once and cached) runs in turns with each commit's, and how it compares with its usual values is that job's machine factor. The PR comment compares the adjusted values with the median and range of master's last 10 runs (🟢 better, 🟡 within range, 🔴 clearly worse, ⬆️ / ⬇️ for the direction), and the performance page charts them (once enough runs have the reference)
