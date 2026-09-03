import type { NativeBridgeBatchOperation, SQLiteArg } from '../type'

type SQLiteValue = string | number | bigint | Uint8Array | null

export type SQLiteAPI = {
  open_v2: (filename: string, flags?: number, vfs?: string) => Promise<number>
  close: (db: number) => Promise<number>
  statements: (db: number, sql: string) => AsyncIterable<number>
  bind_collection: (statement: number, values: SQLiteValue[]) => number
  step: (statement: number) => Promise<number>
  row: (statement: number) => SQLiteValue[]
  column_names: (statement: number) => string[]
  get_autocommit: (db: number) => number
  vfs_register: (vfs: object, makeDefault?: boolean) => number
}

const SQLITE_ROW = 100

type SchemaColumn = {
  name: string
  type: 'string' | 'number' | 'boolean'
  isOptional?: boolean | undefined
}

type SyncSchema = {
  tables: Record<string, { columnArray: SchemaColumn[] }>
}

type Migration = { from: number; to: number; sql: string }

function fixArgs(args: SQLiteArg[]): SQLiteValue[] {
  return args.map((value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value))
}

function normalizeValue(value: SQLiteValue): unknown {
  if (typeof value === 'bigint') {
    return Number(value)
  }
  return value
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

export default class DatabaseDriver {
  sqlite3: SQLiteAPI

  db: number

  cachedRecords: Record<string, Set<string>> = {}

  constructor(sqlite3: SQLiteAPI, db: number) {
    this.sqlite3 = sqlite3
    this.db = db
  }

  async configure(): Promise<void> {
    await this.executeStatements(
      'PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;',
    )
  }

  async initialize(schemaVersion: number): Promise<
    | { code: 'ok' | 'schema_needed' }
    | { code: 'migrations_needed'; databaseVersion: number }
  > {
    const databaseVersion = await this.getUserVersion()
    if (databaseVersion === schemaVersion) {
      return { code: 'ok' }
    }
    if (databaseVersion > 0 && databaseVersion < schemaVersion) {
      return { code: 'migrations_needed', databaseVersion }
    }
    return { code: 'schema_needed' }
  }

  async setUpWithSchema(schema: string, schemaVersion: number): Promise<void> {
    await this.inTransaction(async () => {
      // Recheck under the write lock: another tab may have completed setup
      // after initialize() observed an incompatible version.
      if ((await this.getUserVersion()) === schemaVersion) return
      await this.resetSchema(schema, schemaVersion)
    })
    this.cachedRecords = {}
  }

  async setUpWithMigrations(migration: Migration): Promise<void> {
    await this.inTransaction(async () => {
      const currentVersion = await this.getUserVersion()
      if (currentVersion === migration.to) {
        return
      }
      if (currentVersion !== migration.from) {
        throw new Error(
          `Incompatible migration set applied. DB: ${currentVersion}, migration: ${migration.from}`,
        )
      }
      await this.executeStatements(migration.sql)
      await this.setUserVersion(migration.to)
    })
  }

  async find(table: string, id: string): Promise<string | Record<string, unknown> | null> {
    if (this.isCached(table, id)) {
      return id
    }
    const rows = await this.queryRaw(`SELECT * FROM ${quoteIdentifier(table)} WHERE id == ? LIMIT 1`, [
      id,
    ])
    if (!rows.length) {
      return null
    }
    this.markAsCached(table, id)
    return rows[0]
  }

  async cachedQuery(
    table: string,
    sql: string,
    args: SQLiteArg[],
  ): Promise<Array<string | Record<string, unknown>>> {
    const rows = await this.queryRaw(sql, args)
    return rows.map((row) => {
      const id = String(row.id)
      if (this.isCached(table, id)) {
        return id
      }
      this.markAsCached(table, id)
      return row
    })
  }

  async queryIds(sql: string, args: SQLiteArg[]): Promise<string[]> {
    return (await this.queryRaw(sql, args)).map((row) => String(row.id))
  }

  async count(sql: string, args: SQLiteArg[]): Promise<number> {
    const rows = await this.queryRaw(sql, args)
    if (!rows.length || rows[0].count === undefined) {
      throw new Error('Invalid count query, cannot find `count` column')
    }
    return Number(rows[0].count)
  }

  async queryRaw(sql: string, args: SQLiteArg[] = []): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = []
    await this.eachStatement(sql, async (statement) => {
      this.sqlite3.bind_collection(statement, fixArgs(args))
      const columns = this.sqlite3.column_names(statement)
      while ((await this.sqlite3.step(statement)) === SQLITE_ROW) {
        const values = this.sqlite3.row(statement)
        const row: Record<string, unknown> = {}
        columns.forEach((column, index) => {
          row[column] = normalizeValue(values[index])
        })
        rows.push(row)
      }
    })
    return rows
  }

  async execute(sql: string, args: SQLiteArg[] = []): Promise<void> {
    await this.eachStatement(sql, async (statement) => {
      this.sqlite3.bind_collection(statement, fixArgs(args))
      while ((await this.sqlite3.step(statement)) === SQLITE_ROW) {
        // Exhaust result rows so statements complete before finalization.
      }
    })
  }

  async executeStatements(sql: string): Promise<void> {
    await this.eachStatement(sql, async (statement) => {
      while ((await this.sqlite3.step(statement)) === SQLITE_ROW) {
        // Exhaust every statement, including PRAGMA statements that return rows.
      }
    })
  }

  async batch(operations: NativeBridgeBatchOperation[]): Promise<void> {
    const added: Array<[string, string]> = []
    const removed: Array<[string, string]> = []
    await this.inTransaction(async () => {
      for (const [cacheBehavior, table, sql, batches] of operations) {
        for (const args of batches) {
          await this.execute(sql, args)
          if (cacheBehavior === 1) {
            added.push([table as string, String(args[0])])
          } else if (cacheBehavior === -1) {
            removed.push([table as string, String(args[0])])
          }
        }
      }
    })
    added.forEach(([table, id]) => this.markAsCached(table, id))
    removed.forEach(([table, id]) => this.removeFromCache(table, id))
  }

  async getLocal(key: string): Promise<unknown> {
    const rows = await this.queryRaw('SELECT "value" FROM "local_storage" WHERE "key" = ?', [key])
    return rows.length ? rows[0].value : null
  }

  async unsafeResetDatabase(schema: { sql: string; version: number }): Promise<void> {
    await this.inTransaction(async () => {
      await this.resetSchema(schema.sql, schema.version)
    })
    this.cachedRecords = {}
  }

  async unsafeLoadFromSync(
    json: string,
    schema: SyncSchema,
    preamble: string,
    postamble: string,
  ): Promise<Record<string, string>> {
    const document = JSON.parse(json) as Record<string, unknown>
    const residual: Record<string, string> = {}
    Object.keys(document).forEach((key) => {
      if (key !== 'changes') {
        residual[key] = JSON.stringify(document[key])
      }
    })

    await this.inTransaction(async () => {
      await this.executeStatements(preamble)
      const changes = document.changes
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
        throw new Error('expected changes field to be an object')
      }
      for (const [tableName, rawChangeSet] of Object.entries(changes)) {
        if (!rawChangeSet || typeof rawChangeSet !== 'object' || Array.isArray(rawChangeSet)) {
          throw new Error('expected table changeset to be an object')
        }
        for (const [operation, rawRecords] of Object.entries(rawChangeSet)) {
          if (!Array.isArray(rawRecords)) {
            throw new Error('expected changeset field to be an array')
          }
          if (operation === 'deleted') {
            if (rawRecords.length) {
              throw new Error('expected deleted field to be empty')
            }
            continue
          }
          if (operation !== 'created' && operation !== 'updated') {
            throw new Error('bad changeset field')
          }
          const table = schema.tables[tableName]
          if (!table) {
            continue
          }
          const columns = table.columnArray
          const sql = `INSERT INTO ${quoteIdentifier(tableName)} (${[
            'id',
            '_status',
            '_changed',
            ...columns.map(({ name }) => name),
          ]
            .map(quoteIdentifier)
            .join(', ')}) VALUES (${Array(columns.length + 3).fill('?').join(', ')})`
          for (const rawRecord of rawRecords) {
            if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) {
              throw new Error('expected sync record to be an object')
            }
            const record = rawRecord as Record<string, unknown>
            if (typeof record.id !== 'string') {
              throw new Error('expected sync record id to be a string')
            }
            const values: SQLiteArg[] = [record.id, 'synced', '']
            columns.forEach((column) => {
              const value = record[column.name]
              if (column.type === 'string' && typeof value === 'string') {
                values.push(value)
              } else if (column.type === 'number' && typeof value === 'number') {
                values.push(value)
              } else if (
                column.type === 'boolean' &&
                (typeof value === 'boolean' || value === 0 || value === 1)
              ) {
                values.push(value as boolean | number)
              } else {
                values.push(column.isOptional ? null : column.type === 'string' ? '' : 0)
              }
            })
            await this.execute(sql, values)
          }
        }
      }
      await this.executeStatements(postamble)
    })
    return residual
  }

  async close(): Promise<void> {
    await this.sqlite3.close(this.db)
  }

  clearCachedRecords(): void {
    this.cachedRecords = {}
  }

  private async getUserVersion(): Promise<number> {
    const rows = await this.queryRaw('PRAGMA user_version')
    return Number(rows[0]?.user_version ?? 0)
  }

  private async setUserVersion(version: number): Promise<void> {
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new Error(`Invalid schema version ${version}`)
    }
    await this.execute(`PRAGMA user_version = ${version}`)
  }

  private async resetSchema(sql: string, version: number): Promise<void> {
    const objects = await this.queryRaw(
      `SELECT type, name FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY CASE type WHEN 'view' THEN 1 WHEN 'trigger' THEN 2 WHEN 'index' THEN 3 ELSE 4 END`,
    )
    for (const object of objects) {
      const type = String(object.type).toUpperCase()
      if (type === 'TABLE' || type === 'VIEW' || type === 'TRIGGER' || type === 'INDEX') {
        await this.execute(`DROP ${type} IF EXISTS ${quoteIdentifier(String(object.name))}`)
      }
    }
    await this.executeStatements(sql)
    await this.setUserVersion(version)
  }

  private async inTransaction(action: () => Promise<void>): Promise<void> {
    await this.execute('BEGIN EXCLUSIVE TRANSACTION')
    try {
      await action()
      await this.execute('COMMIT TRANSACTION')
    } catch (error) {
      if (!this.sqlite3.get_autocommit(this.db)) {
        try {
          await this.execute('ROLLBACK TRANSACTION')
        } catch {
          // Preserve the operation error if SQLite already rolled the transaction back.
        }
      }
      throw error
    }
  }

  // The library's Babel pipeline targets older React Native engines and does not
  // preserve `for await`. Consume wa-sqlite's async generator explicitly so the
  // worker build keeps asynchronous statement preparation/finalization intact.
  private async eachStatement(
    sql: string,
    action: (statement: number) => Promise<void>,
  ): Promise<void> {
    const iterator = this.sqlite3.statements(this.db, sql)[Symbol.asyncIterator]()
    try {
      let isDone = false
      while (!isDone) {
        const next = await iterator.next()
        isDone = Boolean(next.done)
        if (!isDone) {
          await action(next.value)
        }
      }
    } finally {
      if (iterator.return) {
        await iterator.return()
      }
    }
  }

  private isCached(table: string, id: string): boolean {
    return this.cachedRecords[table]?.has(id) ?? false
  }

  private markAsCached(table: string, id: string): void {
    this.cachedRecords[table] ??= new Set()
    this.cachedRecords[table].add(id)
  }

  private removeFromCache(table: string, id: string): void {
    this.cachedRecords[table]?.delete(id)
  }
}
