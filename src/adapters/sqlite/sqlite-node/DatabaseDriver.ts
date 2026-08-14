import Database from './Database'
import type { NativeBridgeBatchOperation, SQLiteArg } from '../type'

function fixArgs(args: SQLiteArg[]): SQLiteArg[] {
  return args.map((value) => {
    if (typeof value === 'boolean') {
      return value ? 1 : 0
    }
    return value
  })
}

type Migrations = { from: number; to: number; sql: string }

class MigrationNeededError extends Error {
  databaseVersion: number

  type: string

  constructor(databaseVersion: number) {
    super('MigrationNeededError')
    this.databaseVersion = databaseVersion
    this.type = 'MigrationNeededError'
    this.message = 'MigrationNeededError'
  }
}

class SchemaNeededError extends Error {
  type: string

  constructor() {
    super('SchemaNeededError')
    this.type = 'SchemaNeededError'
    this.message = 'SchemaNeededError'
  }
}

export function getPath(dbName: string): string {
  if (dbName === ':memory:' || dbName === 'file::memory:') {
    return dbName
  }

  let path =
    dbName.startsWith('/') || dbName.startsWith('file:') ? dbName : `${process.cwd()}/${dbName}`
  if (path.indexOf('.db') === -1) {
    if (path.indexOf('?') >= 0) {
      const index = path.indexOf('?')
      path = `${path.substring(0, index)}.db${path.substring(index)}`
    } else {
      path = `${path}.db`
    }
  }

  return path
}

class DatabaseDriver {
  static sharedMemoryConnections: { [dbName: string]: Database } = {}

  database: Database = undefined as unknown as Database

  cachedRecords: { [table: string]: Set<string> } = {}

  initialize(dbName: string, schemaVersion: number): void {
    this.init(dbName)
    this.isCompatible(schemaVersion)
  }

  setUpWithSchema(dbName: string, schema: string, schemaVersion: number): void {
    this.init(dbName)
    this.unsafeResetDatabase({ version: schemaVersion, sql: schema })
    this.isCompatible(schemaVersion)
  }

  setUpWithMigrations(dbName: string, migrations: Migrations): void {
    this.init(dbName)
    this.migrate(migrations)
    this.isCompatible(migrations.to)
  }

  init(dbName: string): void {
    this.database = new Database(getPath(dbName))

    const isSharedMemory = dbName.indexOf('mode=memory') > 0 && dbName.indexOf('cache=shared') > 0
    if (isSharedMemory) {
      if (!DatabaseDriver.sharedMemoryConnections[dbName]) {
        DatabaseDriver.sharedMemoryConnections[dbName] = this.database
      }
      this.database = DatabaseDriver.sharedMemoryConnections[dbName]
    }
  }

  find(table: string, id: string): string | Record<string, unknown> | null {
    if (this.isCached(table, id)) {
      return id
    }

    const query = `SELECT * FROM '${table}' WHERE id == ? LIMIT 1`
    const results = this.database.queryRaw(query, [id])

    if (results.length === 0) {
      return null
    }

    this.markAsCached(table, id)
    return results[0]
  }

  cachedQuery(table: string, query: string, args: SQLiteArg[]): Array<string | Record<string, unknown>> {
    const results = this.database.queryRaw(query, fixArgs(args))
    return results.map((row) => {
      const id = `${row.id}`
      if (this.isCached(table, id)) {
        return id
      }
      this.markAsCached(table, id)
      return row
    })
  }

  queryIds(query: string, args: SQLiteArg[]): string[] {
    return this.database.queryRaw(query, fixArgs(args)).map((row) => `${row.id}`)
  }

  unsafeQueryRaw(query: string, args: SQLiteArg[]): Record<string, unknown>[] {
    return this.database.queryRaw(query, fixArgs(args))
  }

  count(query: string, args: SQLiteArg[]): number {
    return this.database.count(query, fixArgs(args))
  }

  batch(operations: NativeBridgeBatchOperation[]): void {
    const newIds: Array<[string, string]> = []
    const removedIds: Array<[string, string]> = []

    this.database.inTransaction(() => {
      operations.forEach((operation) => {
        const [cacheBehavior, table, sql, argBatches] = operation
        argBatches.forEach((args) => {
          this.database.execute(sql, fixArgs(args))
          if (cacheBehavior === 1) {
            newIds.push([table as string, args[0] as string])
          } else if (cacheBehavior === -1) {
            removedIds.push([table as string, args[0] as string])
          }
        })
      })
    })

    newIds.forEach(([table, id]) => {
      this.markAsCached(table, id)
    })

    removedIds.forEach(([table, id]) => {
      this.removeFromCache(table, id)
    })
  }

  // MARK: - LocalStorage

  getLocal(key: string): unknown {
    const results = this.database.queryRaw('SELECT `value` FROM `local_storage` WHERE `key` = ?', [
      key,
    ])

    if (results.length > 0) {
      return results[0].value
    }

    return null
  }

  // MARK: - Record caching

  hasCachedTable(table: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.cachedRecords, table)
  }

  isCached(table: string, id: string): boolean {
    if (this.hasCachedTable(table)) {
      return this.cachedRecords[table].has(id)
    }
    return false
  }

  markAsCached(table: string, id: string): void {
    if (!this.hasCachedTable(table)) {
      this.cachedRecords[table] = new Set()
    }
    this.cachedRecords[table].add(id)
  }

  removeFromCache(table: string, id: string): void {
    if (this.hasCachedTable(table) && this.cachedRecords[table].has(id)) {
      this.cachedRecords[table].delete(id)
    }
  }

  // MARK: - Other private details

  isCompatible(schemaVersion: number): void {
    const databaseVersion = this.database.userVersion
    if (schemaVersion !== databaseVersion) {
      if (databaseVersion > 0 && databaseVersion < schemaVersion) {
        throw new MigrationNeededError(databaseVersion)
      } else {
        throw new SchemaNeededError()
      }
    }
  }

  unsafeResetDatabase(schema: { sql: string; version: number }): void {
    this.database.unsafeDestroyEverything()
    this.cachedRecords = {}

    this.database.inTransaction(() => {
      this.database.executeStatements(schema.sql)
      this.database.userVersion = schema.version
    })
  }

  migrate(migrations: Migrations): void {
    const databaseVersion = this.database.userVersion

    if (`${databaseVersion}` !== `${migrations.from}`) {
      throw new Error(
        `Incompatbile migration set applied. DB: ${databaseVersion}, migration: ${migrations.from}`,
      )
    }

    this.database.inTransaction(() => {
      this.database.executeStatements(migrations.sql)
      this.database.userVersion = migrations.to
    })
  }
}

export default DatabaseDriver
