type SqliteStatement = {
  run: (args: unknown[]) => unknown
  get: (args: unknown[]) => unknown
  all: (args: unknown[]) => unknown[]
}

type SqliteDatabase = {
  open: boolean
  memory: boolean
  transaction: (executeBlock: () => void) => () => void
  prepare: (query: string) => SqliteStatement
  exec: (queries: string) => unknown
  pragma: ((sql: string, options: { simple: boolean }) => unknown) & ((sql: string) => unknown)
  close: () => void
}

type BetterSqlite3Constructor = new (
  path: string,
  options?: { verboze?: typeof console.log },
) => SqliteDatabase

const SQliteDatabase = require('better-sqlite3') as BetterSqlite3Constructor

class Database {
  instance: SqliteDatabase = undefined as unknown as SqliteDatabase

  path: string

  constructor(path: string = ':memory:') {
    this.path = path
    // this.instance = new SQliteDatabase(path);
    this.open()
  }

  open(): void {
    let { path } = this
    if (path === 'file::memory:' || path.indexOf('?mode=memory') >= 0) {
      path = ':memory:'
    }

    try {
      // eslint-disable-next-line no-console
      this.instance = new SQliteDatabase(path, { verboze: console.log })
    } catch (error) {
      throw new Error(`Failed to open the database. - ${(error as Error).message}`)
    }

    if (!this.instance || !this.instance.open) {
      throw new Error('Failed to open the database.')
    }
  }

  inTransaction(executeBlock: () => void): void {
    this.instance.transaction(executeBlock)()
  }

  execute(query: string, args: unknown[] = []): unknown {
    return this.instance.prepare(query).run(args)
  }

  executeStatements(queries: string): unknown {
    return this.instance.exec(queries)
  }

  queryRaw(query: string, args: unknown[] = []): Record<string, unknown>[] {
    let results: Record<string, unknown>[] = []
    const stmt = this.instance.prepare(query)
    if (stmt.get(args)) {
      results = stmt.all(args) as Record<string, unknown>[]
    }
    return results
  }

  count(query: string, args: unknown[] = []): number {
    const results = this.instance.prepare(query).all(args)

    if (results.length === 0) {
      throw new Error('Invalid count query, can`t find next() on the result')
    }

    const result = results[0] as { count?: unknown }

    if (result.count === undefined) {
      throw new Error('Invalid count query, can`t find `count` column')
    }

    return Number.parseInt(result.count as string, 10)
  }

  get userVersion(): number {
    return this.instance.pragma('user_version', {
      simple: true,
    }) as number
  }

  set userVersion(version: number) {
    this.instance.pragma(`user_version = ${version}`)
  }

  // Wipes the database in place, on this connection -- like the native adapters do (which use
  // SQLITE_DBCONFIG_RESET_DATABASE, not exposed by better-sqlite3). It used to close, delete the
  // file and reopen it, which broke every other connection to the same file: Windows refuses to
  // delete an open file (EBUSY), and elsewhere they were left on the deleted file, reading stale
  // data until their next write failed with SQLITE_READONLY_DBMOVED (#172).
  unsafeDestroyEverything(): void {
    const secureDelete = this.instance.pragma('secure_delete', { simple: true })
    // Zero out freed pages, so the old data is gone even if VACUUM below can't run
    this.instance.pragma('secure_delete = ON')
    try {
      this.inTransaction(() => {
        // Dropping a table also drops its indexes and triggers
        const objects = this.queryRaw(
          `SELECT type, name FROM sqlite_master WHERE type IN ('view', 'table') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type DESC`,
        )
        objects.forEach(({ type, name }) => {
          const quotedName = `"${String(name).replace(/"/g, '""')}"`
          this.execute(`DROP ${type === 'view' ? 'VIEW' : 'TABLE'} IF EXISTS ${quotedName}`)
        })
        // SQLite's own bookkeeping tables can't be dropped (sqlite_sequence) or don't need to be
        const internalTables = this.queryRaw(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('sqlite_sequence', 'sqlite_stat1', 'sqlite_stat4')`,
        )
        internalTables.forEach(({ name }) => {
          this.execute(`DELETE FROM ${String(name)}`)
        })
        this.execute('PRAGMA user_version = 0')
      })
    } finally {
      this.instance.pragma(`secure_delete = ${secureDelete ? 'ON' : 'OFF'}`)
    }

    if (!this.isInMemoryDatabase()) {
      // Shrink the file. Can't run inside a transaction, and can't run while another connection is
      // reading. That's fine: the reset itself is already committed, so don't wait for readers.
      const busyTimeout = this.instance.pragma('busy_timeout', { simple: true })
      this.instance.pragma('busy_timeout = 0')
      try {
        this.instance.exec('VACUUM')
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code !== 'SQLITE_BUSY' && code !== 'SQLITE_LOCKED') {
          throw error
        }
      } finally {
        this.instance.pragma(`busy_timeout = ${Number(busyTimeout)}`)
      }
    }
  }

  isInMemoryDatabase(): boolean {
    return this.instance.memory
  }
}

export default Database
