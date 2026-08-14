const fs = require('fs') as {
  existsSync: (path: string) => boolean
  unlinkSync: (path: string) => void
}

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

  unsafeDestroyEverything(): void {
    // Deleting files by default because it seems simpler, more reliable
    // And we have a weird problem with sqlite code 6 (database busy) in sync mode
    // But sadly this won't work for in-memory (shared) databases, so in those cases,
    // drop all tables, indexes, and reset user version to 0

    if (this.isInMemoryDatabase()) {
      this.inTransaction(() => {
        const results = this.queryRaw(`SELECT * FROM sqlite_master WHERE type = 'table'`)
        const tables = results.map((table) => String(table.name))

        tables.forEach((table) => {
          this.execute(`DROP TABLE IF EXISTS '${table}'`)
        })

        this.execute('PRAGMA writable_schema=1')
        const count = this.queryRaw(`SELECT * FROM sqlite_master`).length
        if (count) {
          // IF required to avoid SQLIte Error
          this.execute('DELETE FROM sqlite_master')
        }
        this.execute('PRAGMA user_version=0')
        this.execute('PRAGMA writable_schema=0')
      })
    } else {
      this.instance.close()
      if (this.instance.open) {
        throw new Error('Could not close database')
      }

      if (fs.existsSync(this.path)) {
        fs.unlinkSync(this.path)
      }
      if (fs.existsSync(`${this.path}-wal`)) {
        fs.unlinkSync(`${this.path}-wal`)
      }
      if (fs.existsSync(`${this.path}-shm`)) {
        fs.unlinkSync(`${this.path}-shm`)
      }

      this.open()
    }
  }

  isInMemoryDatabase(): boolean {
    return this.instance.memory
  }
}

export default Database
