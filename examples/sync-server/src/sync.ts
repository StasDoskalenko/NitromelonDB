// The pull and push endpoints, as plain functions over a SQLite database. They don't depend on Hono
// (see app.ts), so the same logic can be dropped into Express, Nest, a serverless function, etc.
//
// Numbers in comments like "(pull 5)" refer to the numbered rules in the docs:
// docs-website/docs/docs/Sync/Backend.md

import { currentTimestamp, nextTimestamp, type Db } from './db.ts'
import type { ColumnSchema, ServerSchema, TableSchema } from './schema.ts'

export type Value = string | number | boolean | null
export type RawRecord = { id: string; [column: string]: Value }
export type TableChanges = { created: RawRecord[]; updated: RawRecord[]; deleted: string[] }
export type Changes = { [table: string]: TableChanges }
export type Migration = {
  from: number
  tables: string[]
  columns: { table: string; columns: string[] }[]
}

export type PullParams = {
  lastPulledAt: number | null
  schemaVersion: number
  migration: Migration | null
}
export type PullResult = { changes: Changes; timestamp: number }
export type PullOptions = {
  // Send every changed record as `updated`, never `created` (Backend.md, last tips). The app must
  // then pass `sendCreatedAsUpdated: true` to synchronize(). This is the default in this server; see
  // README.md for why splitting `created` and `updated` by server_created_at goes wrong.
  sendCreatedAsUpdated: boolean
}
export type PushParams = { changes: unknown; lastPulledAt: unknown }

// An error with an HTTP status: 400 for a malformed request, 409 when a push conflicts with changes
// made on the server since the client last pulled
export class SyncError extends Error {
  status: 400 | 409
  conflicts: { table: string; id: string }[]

  constructor(status: 400 | 409, message: string, conflicts: { table: string; id: string }[] = []) {
    super(message)
    this.status = status
    this.conflicts = conflicts
  }
}

// Default ids are 16 alphanumeric characters; `_-.` are allowed for custom id generators (pull 11)
const idPattern = /^[a-zA-Z0-9_.-]{1,64}$/

type Row = { id: string; last_modified: number; server_created_at: number; deleted: number } & {
  [column: string]: Value
}

// MARK: - Pull

export function pull(
  db: Db,
  schema: ServerSchema,
  params: PullParams,
  options: PullOptions,
): PullResult {
  const { lastPulledAt, migration } = params
  const { sendCreatedAsUpdated } = options

  // better-sqlite3 runs the whole transaction synchronously on one connection, so no push can
  // commit between reading the timestamp and reading the rows. That's the consistent view pull 5
  // asks for: every change with last_modified <= timestamp is in this response, and every later
  // change has last_modified > timestamp and will be in the next one (pull 4).
  return db.transaction((): PullResult => {
    const timestamp = currentTimestamp(db)
    const changes: Changes = {}

    for (const table of schema.tables) {
      const tableChanges: TableChanges = { created: [], updated: [], deleted: [] }
      changes[table.name] = tableChanges

      const isNewTable = migration?.tables.includes(table.name) ?? false
      if (!lastPulledAt || isNewTable) {
        // First sync (pull 3), or a table the client just added in a migration and has no records
        // of yet (pull 6): everything that isn't deleted
        const rows = db.prepare(`select * from "${table.name}" where "deleted" = 0`).all() as Row[]
        const target = sendCreatedAsUpdated ? tableChanges.updated : tableChanges.created
        rows.forEach((row) => target.push(toRawRecord(table, row)))
        continue
      }

      const rows = db
        .prepare(`select * from "${table.name}" where "last_modified" > ?`)
        .all(lastPulledAt) as Row[]
      const sentIds = new Set<string>()
      rows.forEach((row) => {
        sentIds.add(row.id)
        if (row.deleted) {
          tableChanges.deleted.push(row.id)
        } else if (!sendCreatedAsUpdated && row.server_created_at > lastPulledAt) {
          tableChanges.created.push(toRawRecord(table, row))
        } else {
          tableChanges.updated.push(toRawRecord(table, row))
        }
      })

      // Columns the client just added in a migration (pull 6): the client has these records, but
      // with the new column at its default value. Send every record where the server has something
      // else. Only columns in the server schema are considered (the whitelist pull 6 asks for).
      const newColumns = (
        migration?.columns.find((entry) => entry.table === table.name)?.columns ?? []
      )
        .map((name) => table.columns.find((column) => column.name === name))
        .filter((column): column is ColumnSchema => column !== undefined)
      if (newColumns.length) {
        const nonDefault = newColumns.map(nonDefaultSql).join(' or ')
        const migrated = db
          .prepare(`select * from "${table.name}" where "deleted" = 0 and (${nonDefault})`)
          .all() as Row[]
        migrated.forEach((row) => {
          // Record IDs must not be duplicated (pull 2)
          if (!sentIds.has(row.id)) {
            tableChanges.updated.push(toRawRecord(table, row))
          }
        })
      }
    }

    return { changes, timestamp }
  })()
}

// Only whitelisted columns go out: never the change-tracking columns (pull 7, 8, 10)
function toRawRecord(table: TableSchema, row: Row): RawRecord {
  const raw: RawRecord = { id: row.id }
  table.columns.forEach((column) => {
    const value = row[column.name] ?? null
    raw[column.name] = column.type === 'boolean' && value !== null ? value === 1 : value
  })
  return raw
}

function nonDefaultSql(column: ColumnSchema): string {
  const name = `"${column.name}"`
  if (column.isOptional) {
    return `${name} is not null`
  }
  return column.type === 'string'
    ? `(${name} is not null and ${name} != '')`
    : `(${name} is not null and ${name} != 0)`
}

// MARK: - Push

export function push(db: Db, schema: ServerSchema, params: PushParams): void {
  const { lastPulledAt } = params
  if (typeof lastPulledAt !== 'number' || !Number.isFinite(lastPulledAt)) {
    throw new SyncError(400, 'lastPulledAt must be a number (pull before pushing)')
  }
  const changes = validateChanges(schema, params.changes)

  // One transaction for the whole push (push 7): if anything fails, nothing is written. Conflicts
  // are collected first and reported together, so the client can see everything that clashed.
  db.transaction(() => {
    const timestamp = nextTimestamp(db)
    const conflicts: { table: string; id: string }[] = []

    for (const table of schema.tables) {
      const tableChanges = changes[table.name]
      if (!tableChanges) {
        continue
      }
      const find = db.prepare(
        `select "id", "last_modified", "deleted" from "${table.name}" where "id" = ?`,
      )

      // A row with last_modified === timestamp was written earlier in this same push (e.g. deleted
      // along with its parent below), which isn't a conflict
      const changedByOthers = (row: { last_modified: number }): boolean =>
        row.last_modified > lastPulledAt && row.last_modified !== timestamp

      for (const raw of [...tableChanges.created, ...tableChanges.updated]) {
        const existing = find.get(raw.id) as
          Pick<Row, 'id' | 'last_modified' | 'deleted'> | undefined
        if (!existing) {
          // A new record, or an update to a record the server never had (push 3: create it, so a
          // bug somewhere doesn't keep sync failing forever)
          insertRecord(db, table, raw, timestamp)
        } else if (existing.deleted && existing.last_modified === timestamp) {
          // Deleted by this push, along with its parent: the deletion wins
        } else if (changedByOthers(existing)) {
          // Changed on the server after this client pulled (push 5)
          conflicts.push({ table: table.name, id: raw.id })
        } else if (existing.deleted) {
          // Deleted on the server: return an error so the client pulls the deletion (push 3). The
          // deletion happened before lastPulledAt, so the next pull won't send it again; the client
          // gets it on its next full sync. In practice clients don't get here, since a pull deletes
          // the record locally.
          conflicts.push({ table: table.name, id: raw.id })
        } else {
          // Includes a `created` record that already exists, because an earlier push reached the
          // server but the app never marked it as synced (push 2: update it, don't fail)
          updateRecord(db, table, raw, timestamp)
        }
      }

      for (const id of tableChanges.deleted) {
        const existing = find.get(id) as Pick<Row, 'id' | 'last_modified' | 'deleted'> | undefined
        if (!existing || existing.deleted) {
          // Already gone, e.g. deleted by someone else or by an earlier push (push 4)
          continue
        }
        if (changedByOthers(existing)) {
          conflicts.push({ table: table.name, id })
          continue
        }
        deleteRecords(db, schema, table, [id], timestamp)
      }
    }

    if (conflicts.length) {
      // Throwing rolls the transaction back, including the timestamp
      throw new SyncError(
        409,
        'Records were changed on the server since the last pull. Pull and try again.',
        conflicts,
      )
    }
  })()
}

function insertRecord(db: Db, table: TableSchema, raw: RawRecord, timestamp: number): void {
  // Columns missing from the push get their default value
  const values = table.columns.map((column) => sanitize(column, raw[column.name]))
  const names = [
    'id',
    ...table.columns.map((column) => column.name),
    'last_modified',
    'server_created_at',
  ]
  db.prepare(
    `insert into "${table.name}" (${names.map((name) => `"${name}"`).join(', ')}) values (${names.map(() => '?').join(', ')})`,
  ).run(raw.id, ...values, timestamp, timestamp)
}

function updateRecord(db: Db, table: TableSchema, raw: RawRecord, timestamp: number): void {
  // Only columns present in the push are written. A client on an older schema version doesn't send
  // columns it doesn't know about yet, and must not reset them to defaults.
  const columns = table.columns.filter((column) => Object.hasOwn(raw, column.name))
  const assignments = [...columns.map((column) => `"${column.name}" = ?`), '"last_modified" = ?']
  db.prepare(`update "${table.name}" set ${assignments.join(', ')} where "id" = ?`).run(
    ...columns.map((column) => sanitize(column, raw[column.name])),
    timestamp,
    raw.id,
  )
}

// Marks records as deleted, and their descendants too (push 11), so a buggy client can't leave
// orphans behind
function deleteRecords(
  db: Db,
  schema: ServerSchema,
  table: TableSchema,
  ids: string[],
  timestamp: number,
): void {
  if (!ids.length) {
    return
  }
  const placeholders = ids.map(() => '?').join(', ')
  db.prepare(
    `update "${table.name}" set "deleted" = 1, "last_modified" = ? where "id" in (${placeholders}) and "deleted" = 0`,
  ).run(timestamp, ...ids)

  for (const child of schema.tables) {
    for (const relation of child.belongsTo ?? []) {
      if (relation.table !== table.name) {
        continue
      }
      const childIds = (
        db
          .prepare(
            `select "id" from "${child.name}" where "${relation.column}" in (${placeholders}) and "deleted" = 0`,
          )
          .all(...ids) as { id: string }[]
      ).map((row) => row.id)
      deleteRecords(db, schema, child, childIds, timestamp)
    }
  }
}

// Fix values instead of rejecting them (push 10): a wrong type becomes the column's default, the
// same thing the app does when it reads a bad value. Booleans are stored as 0/1.
function sanitize(column: ColumnSchema, value: unknown): string | number | null {
  if (column.type === 'string') {
    return typeof value === 'string' ? value : column.isOptional ? null : ''
  }
  if (column.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : column.isOptional
        ? null
        : 0
  }
  return typeof value === 'boolean' ? Number(value) : column.isOptional ? null : 0
}

// The shape is checked strictly (a bad shape is a programming error), while values are sanitized
// leniently (push 9, 10). Unknown columns, `_status` and `_changed` are ignored (push 8).
function validateChanges(schema: ServerSchema, changes: unknown): Changes {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new SyncError(400, 'changes must be an object of per-table changes')
  }
  const tableNames = new Set(schema.tables.map((table) => table.name))
  const result: Changes = {}

  for (const [tableName, tableChanges] of Object.entries(changes)) {
    if (!tableNames.has(tableName)) {
      throw new SyncError(400, `Unknown table: ${tableName}`)
    }
    if (!tableChanges || typeof tableChanges !== 'object') {
      throw new SyncError(400, `Changes for ${tableName} must be an object`)
    }
    const {
      created = [],
      updated = [],
      deleted = [],
    } = tableChanges as Partial<Record<keyof TableChanges, unknown>>
    if (!Array.isArray(created) || !Array.isArray(updated) || !Array.isArray(deleted)) {
      throw new SyncError(400, `created, updated and deleted for ${tableName} must be arrays`)
    }
    const checkRecord = (raw: unknown): RawRecord => {
      if (!raw || typeof raw !== 'object' || !isValidId((raw as { id?: unknown }).id)) {
        throw new SyncError(
          400,
          `Invalid record in ${tableName}: records must be objects with a valid id`,
        )
      }
      return raw as RawRecord
    }
    deleted.forEach((id) => {
      if (!isValidId(id)) {
        throw new SyncError(400, `Invalid deleted id in ${tableName}`)
      }
    })
    result[tableName] = {
      created: created.map(checkRecord),
      updated: updated.map(checkRecord),
      deleted: deleted as string[],
    }
  }
  return result
}

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && idPattern.test(id)
}

// MARK: - Parsing pull parameters

export function parsePullParams(query: {
  last_pulled_at?: string
  schema_version?: string
  migration?: string
}): PullParams {
  const lastPulledAt = query.last_pulled_at ? Number(query.last_pulled_at) : null
  if (lastPulledAt !== null && !Number.isFinite(lastPulledAt)) {
    throw new SyncError(400, 'last_pulled_at must be a number')
  }
  const schemaVersion = Number(query.schema_version ?? 1)
  if (!Number.isInteger(schemaVersion)) {
    throw new SyncError(400, 'schema_version must be an integer')
  }

  let migration: Migration | null = null
  if (query.migration && query.migration !== 'null') {
    let parsed: unknown
    try {
      parsed = JSON.parse(query.migration)
    } catch {
      throw new SyncError(400, 'migration must be JSON')
    }
    const candidate = parsed as Partial<Migration> | null
    const isValid =
      !!candidate &&
      typeof candidate.from === 'number' &&
      Array.isArray(candidate.tables) &&
      candidate.tables.every((table) => typeof table === 'string') &&
      Array.isArray(candidate.columns) &&
      candidate.columns.every(
        (entry) =>
          !!entry &&
          typeof entry.table === 'string' &&
          Array.isArray(entry.columns) &&
          entry.columns.every((column) => typeof column === 'string'),
      )
    if (!isValid) {
      throw new SyncError(400, 'migration must be { from, tables, columns }')
    }
    migration = candidate as Migration
  }

  return { lastPulledAt, schemaVersion, migration }
}
