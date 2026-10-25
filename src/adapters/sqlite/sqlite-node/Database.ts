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

function isCorruptionError(error: unknown): boolean {
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && (code === 'SQLITE_NOTADB' || code.startsWith('SQLITE_CORRUPT'))
}

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
  //
  // `setUp` (the new schema) runs in the same transaction as the wipe, so other connections see
  // either the old database or the new one -- never an empty one without tables in between.
  unsafeDestroyEverything(setUp: () => void = () => {}): void {
    try {
      this.inTransaction(() => {
        this.dropEverything()
        setUp()
      })
    } catch (error) {
      // A corrupt file can't be wiped in place. Recreate it instead, so a reset still recovers
      // from corruption -- other connections to a corrupt file are broken either way.
      if (this.isInMemoryDatabase() || !isCorruptionError(error)) {
        throw error
      }
      this.recreateFile()
      this.inTransaction(setUp)
      return
    }

    if (!this.isInMemoryDatabase()) {
      // Shrink the file and drop the old data from its free pages. Can't run inside a transaction,
      // and can't run while another connection is reading: after the usual busy timeout, skip it.
      // The reset itself is already committed.
      try {
        this.instance.exec('VACUUM')
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code !== 'SQLITE_BUSY' && code !== 'SQLITE_LOCKED') {
          throw error
        }
      }
    }
  }

  // Must run in a transaction
  dropEverything(): void {
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
  }

  recreateFile(): void {
    this.instance.close()
    // Including the rollback journal: a leftover one would be replayed into the new file
    ;['', '-wal', '-shm', '-journal'].forEach((suffix) => {
      if (fs.existsSync(this.path + suffix)) {
        fs.unlinkSync(this.path + suffix)
      }
    })
    this.open()
  }

  isInMemoryDatabase(): boolean {
    return this.instance.memory
  }
}

export default Database
