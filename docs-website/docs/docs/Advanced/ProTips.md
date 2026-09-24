---
title: Pro Tips
hide_title: true
---

# Various Pro Tips

## Database viewer

**Android Studio's Database Inspector can't see NitromelonDB databases.** The Inspector only
hooks databases opened through Android's `android.database.sqlite` API (this is how WatermelonDB's
old `jsi: false` mode worked). NitromelonDB opens the file with its own SQLite build from C++, so
the Inspector never sees it. Copy the file off the device and open it in a desktop tool
([DB Browser for SQLite](https://sqlitebrowser.org), [TablePlus](https://tableplus.com), or
`sqlite3`).

**Android** (debug builds): the database is at `/data/data/<applicationId>/<dbName>.db`.
`dbName` defaults to `watermelon`. The database uses WAL mode, so copy the `-wal` file too, or
recent writes will be missing:

```bash
APP=com.example.app   # your applicationId
DB=watermelon         # your SQLiteAdapter dbName
for f in "$DB.db" "$DB.db-wal"; do
  adb exec-out run-as "$APP" cat "$f" > "$f"
done
sqlite3 "$DB.db"
```

In Android Studio you can also use **Device Explorer** → `data/data/<applicationId>` → *Save As*.
Save the `.db` and `.db-wal` files next to each other.

**iOS simulator**: the database is at `Documents/<dbName>.db` in the app's data container:

```bash
open "$(xcrun simctl get_app_container booted <bundleId> data)/Documents"
```

**iOS device**: in Xcode → *Devices and Simulators*, select the app → *Download Container*, then
open `AppData/Documents/<dbName>.db`.

**Web** (wa-sqlite): the database is stored as pages in IndexedDB, so it isn't a file you can
open. Query it from the dev console instead, for example
`await database.get('posts').query(Q.unsafeSqlQuery('select * from posts')).unsafeFetchRaw()`.

The file is a copy, so re-copy it to see new changes.

## Which SQLite version am I using?

This usually only matters if you use raw SQL to use new SQLite versions:

- On iOS, we use whatever SQLite version is bundled with the OS. [Here's a table of iOS version - SQLite version matches](https://github.com/yapstudios/YapDatabase/wiki/SQLite-version-(bundled-with-OS))
- On Android, we compile the amalgamation in `native/vendor/sqlite` (see `sqlite.version`).
- On Windows, we compile the same vendored amalgamation.

BTW: We're happy to accept contributions so that you can choose custom version or build of SQLite in all modes and on all platforms, but it needs to be opt-in (this adds to build time and binary size and most people don't need this)

## Prepopulating database on native

There's no built-in support for this. One way is to generate a SQLite DB (you can use the the Node SQLite support in 0.19.0-2 pre-release or extract it from an ios/android app), bundle it with the app, and then use a bit of code to check if the DB you're expecting it available, and if not, making a copy of the default DB — before you attempt loading DB from JS side. [See discussion](https://github.com/Nozbe/WatermelonDB/issues/774#issuecomment-667981361)

## Override entity ID generator

You can optionally overide WatermelonDB's id generator with your own custom id generator in order to create specific random id formats (e.g. if UUIDs are used in the backend). In your database index file, pass a function with your custom ID generator to `setGenerator`:

```
// Define a custom ID generator.
function randomString(): string {
  return 'RANDOM STRING';
}
setGenerator(randomString);

// or as anonymous function:
setGenerator(() => 'RANDOM STRING');
```

To get UUIDs specifically, install [uuid](https://github.com/uuidjs/uuid) and then pass their id generator to `setGenerator`:

```
import { v4 as uuidv4 } from 'uuid';

setGenerator(() => uuidv4());
```
