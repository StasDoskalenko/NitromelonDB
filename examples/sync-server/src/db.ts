import Database from 'better-sqlite3'

import { type ServerSchema, type ColumnSchema, validateSchema } from './schema.ts'

export type Db = Database.Database

const sqlType = (column: ColumnSchema): string =>
  column.type === 'string' ? 'TEXT' : column.type === 'number' ? 'REAL' : 'INTEGER'

// Every synced table gets three change-tracking columns (Backend.md, "Tips on implementing
// server-side changes tracking"):
// - last_modified: server timestamp of the last create, update or delete. A pull returns rows with
//   last_modified > lastPulledAt, and a push is rejected if a row it touches has
//   last_modified > lastPulledAt (someone else changed it since this client pulled).
// - server_created_at: when the server first saw the record. A pull sends it as `created` if that's
//   after lastPulledAt, and as `updated` otherwise.
// - deleted: tombstone. Deleted rows are kept so that a pull can tell clients to delete them.
export function openDatabase(filename: string, schema: ServerSchema): Db {
  validateSchema(schema)
  const db = new Database(filename)
  if (filename !== ':memory:') {
    db.pragma('journal_mode = WAL')
  }

  db.exec(`
    create table if not exists sync_clock (
      id integer primary key check (id = 1),
      value integer not null
    );
  `)
  // Start the clock at the current time rather than 0: lastPulledAt 0 means "first sync"
  db.prepare('insert or ignore into sync_clock (id, value) values (1, ?)').run(Date.now())

  for (const table of schema.tables) {
    const columns = table.columns.map((column) => `"${column.name}" ${sqlType(column)}`).join(', ')
    db.exec(`
      create table if not exists "${table.name}" (
        "id" text primary key not null,
        ${columns},
        "last_modified" integer not null,
        "server_created_at" integer not null,
        "deleted" integer not null default 0
      );
      create index if not exists "${table.name}_last_modified_id" on "${table.name}" ("last_modified", "id");
    `)
    for (const relation of table.belongsTo ?? []) {
      db.exec(
        `create index if not exists "${table.name}_${relation.column}" on "${table.name}" ("${relation.column}");`,
      )
    }
  }

  return db
}

// The last timestamp handed out. Read inside the pull transaction, it's the `timestamp` a pull
// returns: every change made so far has last_modified <= this value.
export function currentTimestamp(db: Db): number {
  const row = db.prepare('select value from sync_clock where id = 1').get() as { value: number }
  return row.value
}

// A new timestamp for a write, strictly greater than any handed out before, even if the system
// clock goes backwards (NTP adjustments and the like). Backend.md recommends exactly this: millisecond
// resolution, unique and monotonic. Call it inside the write transaction, so that concurrent pushes
// can't get the same value and a rolled back push doesn't use one up.
export function nextTimestamp(db: Db): number {
  const next = Math.max(Date.now(), currentTimestamp(db) + 1)
  db.prepare('update sync_clock set value = ? where id = 1').run(next)
  return next
}
