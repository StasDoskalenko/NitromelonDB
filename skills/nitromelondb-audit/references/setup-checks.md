# Setup checks

Docs: [Setup](https://stasdoskalenko.github.io/NitromelonDB/docs/Setup.md), [Migrations](https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/Migrations.md), [Detect nested writers](https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/DetectNestedWriters.md), [Decorators](https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/StandardDecorators.md), [Performance](https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/Performance.md), [Observability](https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/Observability.md)

## S1. Migrations are passed to the adapter

Look at the adapter options. `migrations` must be there, even if the list of migrations is empty.

Without it, the database is **cleared** whenever the schema version changes: users lose local data on an app update. A `migrations` line that's commented out "for development" and committed is the usual cause.

Not a finding if the app has clearly never shipped (schema version 1, no release config). Say so in the report.

## S2. Migrations and schema agree

- The highest `toVersion` equals the schema `version`. Each migration is exactly one version above the previous one, with no gaps.
- Every table and column that a migration adds is in the schema, with the same `type`, `isOptional` and `isIndexed`. A mismatch means a fresh install and an upgraded install end up with different databases.
- A table or column in the schema that no migration adds is fine only if it existed at the oldest migrated version. If the git history shows it was added later without a migration, upgraded installs don't have it: High.
- `unsafeExecuteSql` strings end with a semicolon.
- Tables are destroyed with `destroyTable()`, not `unsafeExecuteSql('drop table ...')`, so LokiJS and migration syncs see it.
- The schema version isn't lower than a version that already shipped (check tags or release branches if you can): a database newer than the schema is reset.

## S3. `experimentalDetectNestedWriters`

Expected:

```js
new Database({ adapter, modelClasses, experimentalDetectNestedWriters: __DEV__ })
```

- **Missing:** a forgotten `callWriter()` hangs the app with no error. Medium. Recommend `__DEV__` (or `process.env.NODE_ENV !== 'production'` with a web bundler that doesn't define `__DEV__`).
- **`true` unconditionally in app code:** it wraps `Promise.prototype.then` for the whole app on React Native and in browsers, and isn't meant for production builds. Medium.
- **Not on in the Jest setup:** Low. On Node it uses `AsyncLocalStorage`, costs nothing and follows every `await`, so tests catch nested writers whatever platform the app ships on.

## S4. `onSetUpError`

The adapter should get an `onSetUpError` callback that does something the user can see or the team can find: report the error, offer to reload or log out. An empty function, or none, means a database that failed to open looks like an app with no data, and every database call fails with the setup error.

## S5. One `Database` per database file, created once

- `new Database(` (or `new SQLiteAdapter(`) inside a React component body, a hook without memoization, or a function that runs per request or per screen: High. Each instance has its own record cache and its own observers, and setup runs again each time.
- Two `Database` instances on the same `dbName` in one JS runtime: Medium. A write through one isn't seen by the other's cache or observers.
- A module-level singleton, or one instance per logged-in user with its own `dbName`, is the expected shape.

## S6. Readiness

`new Database()` returns at once. Schema setup, migrations and `seed` finish in the background, and every read, write and observation made before that is queued and runs in order. So nothing is lost or reordered if the app uses the database early. What the queue can't do is stop the rest of the app from acting while it waits. That's where the races and flickers come from.

**Gate startup on readiness when the app does work early.** Look at what runs at launch, before the first screen: auth listeners, deep link and push notification handlers, a sync started on import, background tasks, analytics that read the database. For each, ask what happens while the database is still setting up (a long migration, a seed, a slow device):

- **A decision made from "nothing yet".** An observer or hook that hasn't emitted is treated as "no data": `useObservable`'s default value read as "logged out", an empty `useQuery` result read as "no account", a `null` current user. The app then routes to login or onboarding, and jumps back when the real value arrives. Medium, and High if the wrong branch writes something (creates a default record, clears a session).
- **An early listener that writes.** An auth listener that fires at launch and writes the user's record, a push handler that stores a notification. The write is queued and runs after setup and `seed`, in order. That's safe by itself. It's a finding when other code doesn't wait for it: navigation that assumes the record exists, a timeout wrapped around the call, or a second listener event that queues the same write again.
- **Timeouts and retries around database calls.** A call that waits for setup can take as long as the migration does. A timeout that fires first reports a failure that didn't happen, and a retry queues the work twice.
- **A flash of empty UI.** Screens that render an empty state from a query's first result while setup is still running.

Fix: wait once, at the top, and start everything else after it.

```js
// outside React: listeners, sync, background work
await database.readyPromise
startAuthListener()
startSync()
```

```jsx
// in React: nothing below this renders, observes or writes until the database is ready
function Root() {
  const ready = useDatabaseReady(database) // from nitromelondb/hooks
  if (!ready) {
    return <SplashScreen />
  }
  return <App />
}
```

If the app does none of this at launch (it renders and lets queries queue), the gate is optional. Report it as Low, as a recommendation.

Also look for:

- **Hand-made waiting:** `setTimeout` before the first query, a polling loop, an `isDbReady` flag set from an adapter callback, a "warm-up" query. Replace with `database.readyPromise`, `database.isReady` or `useDatabaseReady(database)`.
- **Adapter internals:** reading `adapter._initPromise` or other underscore members to detect readiness. Use `database.readyPromise`.
- **Seeding from the UI:** an effect or a first-render check that creates default records ("if the table is empty, insert..."). It races with sync and with other screens, and can run twice. Use the `seed` option with `databaseSeed()`. On a database that already has user data, read the Seeding page first, and flag this for the user rather than moving it yourself.
- **A failed setup.** If setup fails, every queued call fails with the setup error. Code that waits on `readyPromise` should handle that, together with `onSetUpError` (S4).
- **The dev warning** about an access that had to wait for the database is not an error, but it names exactly this: something touched the database before it was ready. If the user mentions it, find what did, and check it against the list above.

## S7. Leftovers from WatermelonDB

- `jsi: false` on `SQLiteAdapter`: throws on iOS and Android. High. `jsi: true` does nothing: Low.
- `@nozbe/watermelondb` in imports, Jest mocks, `jest.mock()` strings, or `package.json`.
- Old native linking: `pod 'WatermelonDB'` / `simdjson` / `FMDB` in the Podfile, `:watermelondb-jsi` in Gradle files, `WatermelonDBJSIPackage` in `MainApplication`, `@morrowdigital/watermelondb-expo-plugin` in the Expo config.

If you find these, point the user at the `nitromelondb-migrate-from-watermelondb` skill instead of fixing them one by one.

## S8. Decorators are compiled correctly

Work out which decorators version the app compiles (legacy, or standard 2023-11), then check:

- **Expo, legacy:** no `@babel/plugin-proposal-decorators` in `babel.config.js`. A decorators plugin of the app's own runs before the preset's and breaks fields declared with `!` since SDK 56.
- **Bare React Native, legacy:** all four plugins, in this order: decorators (`legacy: true`), class-properties, private-methods, private-property-in-object (each `loose: true`).
- **Standard:** model fields have `accessor`. Fields without it still work but are slower, and development builds warn. `@lazy` is on getters, not fields.
- **Mixed:** `accessor` in models while Babel compiles legacy decorators fails to build.
- **Models compiled by TypeScript or esbuild** (`tsc`, `ts-jest`, `tsx`, Vite without Babel, Bun): `useDefineForClassFields` must be `false`. It defaults to `true` for `ES2022` and newer targets, and then every decorated field reads `undefined` and writes never reach the database.
- **TypeScript with legacy decorators:** `experimentalDecorators: true`. With standard decorators: off, and TypeScript 5.0+.

## S9. `storeWholeNumbersAsIntegers`

If the SQLite adapter doesn't have `storeWholeNumbersAsIntegers: true`, check whether the app could turn it on. Don't turn it on yourself.

1. Find all raw SQL: `Q.unsafeSqlQuery`, `Q.unsafeSqlExpr`, `Q.sortBy(Q.unsafeSqlExpr(...))`, `unsafeExecute` (`{ sqls }` and `{ sqlString }`), `unsafeExecuteSql` migration steps, and `Q.like` / `Q.notLike` / `Q.includes`.
2. From the schema, list the columns of type `number`.
3. For each raw SQL use, decide whether one of these touches a number column or an expression built from one:
   - `/` between two whole numbers (integer division: `7 / 2` is `3`)
   - number to text: `||`, `cast(x as text)`, `printf` / `format`, `Q.like` / `Q.includes` on a number column (`'42'` instead of `'42.0'`)
   - `typeof(x)` (`'integer'` instead of `'real'`)
   - `sum()` that can pass 2^63 (errors; `total()` doesn't)
4. Report each one as SAFE or AFFECTED with a one-line reason, and for AFFECTED ones a fix that gives the same result with the option on or off: `a * 1.0 / b` or `avg()`, `total()`, formatting numbers in JavaScript, numeric comparisons instead of `LIKE`.

Finish with: safe to turn on as is, or safe after the listed fixes. No raw SQL means safe as is. Data already on devices converts in the background, and turning the option off converts it back.

## S10. Logging

Low, informational. NitromelonDB logs setup, query timing and warnings (stuck writers, early access, decorators) through `nitromelondb/utils/common/logger`. In production those are lost unless `logger.warn` / `logger.error` are forwarded to the app's error reporting. Mention it if the app has an error reporter and doesn't forward them.
