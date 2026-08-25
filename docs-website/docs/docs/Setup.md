---
title: 'Setup'
hide_title: true
---

# Set up your app for WatermelonDB

Make sure you [installed Watermelon](./Installation.mdx) before proceeding. Coming from `@nozbe/watermelondb`? See [Migrating from WatermelonDB](./Migrating.md).

## Common

Create `model/schema.js` in your project. You'll need it for [the next step](./Schema.md).

```js
import { appSchema, tableSchema } from 'nitromelondb'

export default appSchema({
  version: 1,
  tables: [
    // We'll add tableSchemas here later
  ]
})
```

Similarly, create `model/migrations.js`. ([More information about migrations](./Advanced/Migrations.md)):

```js
import { schemaMigrations } from 'nitromelondb/Schema/migrations'

export default schemaMigrations({
  migrations: [
    // We'll add migration definitions here later
  ],
})
```

## React Native and Node.js (SQLite)

Now, in your `index.native.js` (React Native) or `index.js` (Node.js):

```js
import { Platform } from 'react-native'
import { Database } from 'nitromelondb'
import SQLiteAdapter from 'nitromelondb/adapters/sqlite'
import { databaseSeed } from 'nitromelondb/Database/seed'

import schema from './model/schema'
import migrations from './model/migrations'
// import Post from './model/Post' // ⬅️ You'll import your Models here

// First, create the adapter to the underlying database:
const adapter = new SQLiteAdapter({
  schema,
  // (You might want to comment it out for development purposes -- see Migrations documentation)
  migrations,
  // (optional database name or file system path)
  // dbName: 'myapp',
  // (recommended option, should work flawlessly out of the box on iOS. On Android,
  // additional installation steps have to be taken - disable if you run into issues...)
  jsi: true, /* Platform.OS === 'ios' */
  // (optional, but you should implement this method)
  onSetUpError: error => {
    // Database failed to load -- offer the user to reload the app or log out
  }
})

// Then, make a Watermelon database from it!
const database = new Database({
  adapter,
  modelClasses: [
    // Post, // ⬅️ You'll add Models to Watermelon here
  ],
  // Throws if you call a writer from another writer without callWriter() (instead of deadlocking)
  // experimentalDetectNestedWriters: true,
  // (optional) seed initial/demo data -- see "Database initialization" below
  // seed: databaseSeed({
  //   steps: [
  //     {
  //       schemaVersion: 1,
  //       run: async (database) => {
  //         await database.batch(database.get(Post).prepareCreate(post => { post.title = 'Hello' }))
  //       },
  //     },
  //   ],
  // }),
})
```

## Database initialization

`new Database(...)` returns immediately -- schema setup/migrations (and `seed`, if configured)
finish asynchronously in the background. You don't need to wait for them: every `write()` /
`read()` / `batch()` call, and every direct read (`collection.find()`, `query().fetch()`,
`query().fetchCount()`, `observe*()` / `experimentalSubscribe*()`, etc.) issued on the `database`
or any `Collection` it returns is automatically queued until the database is actually ready, then
runs in the order it was issued. This is what makes the common "just import a `database.js` module
and use it" pattern from older Watermelon apps safe: nothing you do with `database` before it's
ready is lost or run out of order, it just waits its turn.

In development, an access that has to wait logs a warning once per `Database` instance. That's not
an error -- your code still works correctly -- but it usually means something (a module-level
singleton, a reader/writer that fires as soon as the app starts) is touching the database earlier
than intended, which is worth knowing about even when it happens to be harmless.

If you'd rather gate your own UI on readiness explicitly -- e.g. show a splash screen until the
database is usable, instead of letting reads/writes queue silently underneath a screen that
renders as if nothing were pending -- use `database.isReady` / `database.readyPromise`, or, in a
React component, the `useDatabaseReady(database)` hook (`nitromelondb/hooks` or
`nitromelondb/react`):

```jsx
import { useDatabaseReady } from 'nitromelondb/hooks'

function App({ database }) {
  const ready = useDatabaseReady(database)
  if (!ready) {
    return <LoadingScreen />
  }
  return <Main database={database} />
}
```

`readyPromise` resolves (and `isReady` becomes `true`) once schema setup/migrations and any
pending `seed` steps have settled. This is optional: as covered above, it's always safe to render
immediately and let queuing do its job -- these exist for when you want a different UX than that.

To seed initial or demo data, use the `seed` option shown above (built with `databaseSeed()`)
instead of a "seed on first render" pattern in your UI layer. It's an array of `{ schemaVersion,
run }` steps, each tied to the schema version it was written against -- the same way a migration's
`toVersion` is, instead of an independent counter you'd have to remember to bump yourself. A step
runs at most once, ever, and only once the database has actually reached its `schemaVersion`
(immediately, for a fresh install already on the latest schema; after migrating, for an existing
install catching up) -- with the "did this already happen" tracking handled for you, so `run`
doesn't need to query its own table to decide whether to write. Unlike a migration step, `run` can
freely be asynchronous (`await fetch(...)`, read a file, etc.), since seeding isn't compiled to a
single SQL statement the way schema migrations are. Tying a step to the schema version it depends
on also catches a real class of bug: if `run` uses a column a later migration added, an older step
declaring an earlier `schemaVersion` would otherwise silently write incomplete data once that
migration ships.

## Electron (SQLite)
Electron requires a little extra set up since we have to use IPC between our renderer and main processes to execute queries and return the response. However, if you'd like to use LokiJS instead of SQLite you can skip this section and go to the Web section below.

Let's set things up on the renderer side first.

```js
import RemoteAdapter from 'nitromelondb/adapters/remote'
import { Database } from 'nitromelondb'
import schema from './model/schema'
import migrations from './model/migrations'

const electronAPI = window.electronAPI

const adapter = new RemoteAdapter({
  schema,
  migrations,
  handler: (op, args, callback) => {
    electronAPI.handleAdapter({op, args}).then((res) => callback(res[0]))
  }
})

const database = new Database({
  adapter,
  modelClasses: [
    // Post, // ⬅️ You'll add Models to Watermelon here
  ],
})

export default database
```
Whenever Watermelon needs to interact with the database, it will do so through the remote adapter which in turn sends queries to sqlite over the Electron IPC bridge via the handler callback. 

Now that our renderer is all set, let's set up the other side in `main.js`:
```js
import SQLiteAdapter from "nitromelondb/adapters/sqlite";
import schema from './model/schema'; 
import migrations from './model/migrations';

mainWindow.webContents.on('did-finish-load', () => {
  const adapter = new SQLiteAdapter({
    schema,
    migrations
  })

  async function handleAdapter(_, dispatch) {
    return new Promise((res) => {
      const { op, args } = dispatch;
      adapter[op](...args, (...resp) => res(resp))
    })
  }
  
  ipcMain.removeHandler('db:handle')
  ipcMain.handle('db:handle', handleAdapter)
})
```

Above, we've set up the adapter that will actually interact with our SQLite database. When the renderer sends the `db:handle` event, the handleAdapter callback function will be invoked with the required arguments. It will then return a promise with the data the renderer wants.

Note that we're re-instantiating the adapter inside a `'did-finish-load'` event handler. This ensures the cache maintained in the renderer and main is kept consistent during reloads (manually or due to HMR).

We still need to expose this event to our renderer so in `preload.js` we'll add the following:
```js
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  handleAdapter: (...args) => ipcRenderer.invoke('db:handle', ...args)
})
```

## Web (LokiJS)

This set up is suitable for web apps. 

```js
import LokiJSAdapter from 'nitromelondb/adapters/lokijs'

const adapter = new LokiJSAdapter({
  schema,
  // (You might want to comment out migrations for development purposes -- see Migrations documentation)
  migrations,
  useWebWorker: false,
  useIncrementalIndexedDB: true,
  // dbName: 'myapp', // optional db name

  // --- Optional, but recommended event handlers:

  onQuotaExceededError: (error) => {
    // Browser ran out of disk space -- offer the user to reload the app or log out
  },
  onSetUpError: (error) => {
    // Database failed to load -- offer the user to reload the app or log out
  },
  extraIncrementalIDBOptions: {
    onDidOverwrite: () => {
      // Called when this adapter is forced to overwrite contents of IndexedDB.
      // This happens if there's another open tab of the same app that's making changes.
      // Try to synchronize the app now, and if user is offline, alert them that if they close this
      // tab, some data may be lost
    },
    onversionchange: () => {
      // database was deleted in another browser tab (user logged out), so we must make sure we delete
      // it in this tab as well - usually best to just refresh the page
      if (checkIfUserIsLoggedIn()) {
        window.location.reload()
      }
    },
  }
})

// The rest is the same!
```

* * *

## Next steps

➡️ After Watermelon is installed, [**define your app's schema**](./Schema.md)
