# NitromelonDB

> NitromelonDB (npm: `nitromelondb`) is a reactive, lazy-loading SQLite database for React Native, web, Node.js and Electron. It's a maintained fork of WatermelonDB with the same model: schema, `Model` classes with decorators, observable queries, and offline-first sync with your own backend. Native SQLite runs through Nitro Modules on the React Native New Architecture.

Things to get right when writing code with NitromelonDB:

- Import from `nitromelondb` (`nitromelondb/decorators`, `nitromelondb/hooks`, `nitromelondb/adapters/sqlite`), not `@nozbe/watermelondb`. Existing WatermelonDB schemas, models and SQLite files keep working; see Migrating from WatermelonDB.
- React Native New Architecture only (RN 0.83+). Expo is supported through the `nitromelondb` config plugin in development builds and EAS; Expo Go is not.
- Models use legacy decorators: `@babel/plugin-proposal-decorators` with `{ legacy: true }`.
- Every create, update and delete must run inside a writer: `database.write(async () => ...)` or a `@writer` method on a model.
- Don't call `database.write()` / `database.read()` (or a `@writer` / `@reader` method) from inside another writer or reader and wait for it; that deadlocks. Use `writer.callWriter(() => ...)` / `reader.callReader(() => ...)`. Pass `experimentalDetectNestedWriters: __DEV__` to `new Database()` to turn the mistake into an error during development.
- For UI, observe instead of fetching once: `withObservables` or the hooks in `nitromelondb/hooks` (`useQuery`, `useRecord`, `useWriter`).
- Each link below points to a plain Markdown version of the page. `llms-full.txt` next to this file has the full text of every page except the Optional section.
