import BetterSqlite3 from 'better-sqlite3'
import {
  createFileAdapter,
  openFileAdapter,
  cleanupDb,
} from '../../../__tests__/sqliteTests/helpers'
import { taskQuery, mockTaskRaw } from '../../../__tests__/helpers'
import DatabaseBridge from '../DatabaseBridge'
import SQLiteAdapter from '../..'
import Database from '../../../../Database'
import { databaseSeed } from '../../../../Database/seed'
import { schemaMigrations, unsafeExecuteSql } from '../../../../Schema/migrations'
import { testSchema, modelClasses } from '../../../../__tests__/testModels'

// A database with tables but schema version 0 used to be set up from scratch on open, silently
// deleting the tables. Now opening it fails, and database.unsafeResetDatabase() is the explicit way
// to start over.

const TABLES_WITHOUT_VERSION = /has tables but no schema version/

let dbNames = []

afterEach(() => {
  dbNames.forEach((dbName) => cleanupDb(dbName, 'node'))
  dbNames = []
})

async function tasksDatabaseWithoutVersion() {
  const { adapter, dbName } = await createFileAdapter('node')
  dbNames.push(dbName)
  await adapter.batch([['create', 'tasks', mockTaskRaw({ id: 't1' })]])
  DatabaseBridge.closeAllConnections()
  setUserVersion(dbName, 0)
  return dbName
}

function setUserVersion(dbName, version) {
  const db = new BetterSqlite3(dbName)
  db.pragma(`user_version = ${version}`)
  db.close()
}

const countTasks = (dbName) => {
  const db = new BetterSqlite3(dbName, { readonly: true })
  const { count } = db.prepare('select count(*) as count from tasks').get()
  db.close()
  return count
}

describe('SQLite adapter (Node): a database with tables but no schema version', () => {
  it("fails to open, and doesn't touch the tables", async () => {
    const dbName = await tasksDatabaseWithoutVersion()

    await expect(openFileAdapter(dbName)).rejects.toThrow(TABLES_WITHOUT_VERSION)

    DatabaseBridge.closeAllConnections()
    expect(countTasks(dbName)).toBe(1)
  })

  it('is set up from scratch by unsafeResetDatabase(), after which it works normally', async () => {
    const dbName = await tasksDatabaseWithoutVersion()
    const adapter = new SQLiteAdapter({ dbName, schema: { ...testSchemaForTasks(), version: 1 } })
    await expect(adapter.initializingPromise).rejects.toThrow(TABLES_WITHOUT_VERSION)

    await new Promise((resolve, reject) =>
      adapter.unsafeResetDatabase((result) => (result.error ? reject(result.error) : resolve())),
    )

    const reopened = await openFileAdapter(dbName)
    expect(await reopened.adapter.count(taskQuery())).toBe(0)
    await reopened.adapter.batch([['create', 'tasks', mockTaskRaw({ id: 'after' })]])
    expect(await reopened.adapter.count(taskQuery())).toBe(1)
  })

  it('fails other calls with the setup error until it is reset', async () => {
    const dbName = await tasksDatabaseWithoutVersion()
    const adapter = new SQLiteAdapter({ dbName, schema: { ...testSchemaForTasks(), version: 1 } })
    await expect(adapter.initializingPromise).rejects.toThrow(TABLES_WITHOUT_VERSION)

    const count = () =>
      new Promise((resolve, reject) =>
        adapter.count(taskQuery(), (result) =>
          result.error ? reject(result.error) : resolve(result.value),
        ),
      )
    await expect(count()).rejects.toThrow(/couldn't be set up, so count\(\) can't run/)
    await expect(count()).rejects.toThrow(TABLES_WITHOUT_VERSION)

    await new Promise((resolve, reject) =>
      adapter.unsafeResetDatabase((result) => (result.error ? reject(result.error) : resolve())),
    )
    await expect(count()).resolves.toBe(0)
  })

  it('a reset that fails leaves the tables in place', async () => {
    const dbName = await tasksDatabaseWithoutVersion()
    const adapter = new SQLiteAdapter({ dbName, schema: { ...testSchemaForTasks(), version: 1 } })
    await expect(adapter.initializingPromise).rejects.toThrow(TABLES_WITHOUT_VERSION)
    // Holding the write lock from another connection makes the reset fail
    const other = new BetterSqlite3(dbName)
    other.pragma('busy_timeout = 0')
    other.exec('begin immediate')
    const reset = () =>
      new Promise((resolve, reject) =>
        adapter.unsafeResetDatabase((result) => (result.error ? reject(result.error) : resolve())),
      )

    await expect(withBusyTimeout(0, reset)).rejects.toThrow(/locked|busy/i)

    other.exec('rollback')
    other.close()
    DatabaseBridge.closeAllConnections()
    expect(countTasks(dbName)).toBe(1)
  })

  it.each([
    ['a new, empty file', () => {}],
    [
      'only SQLite-internal tables',
      (db) =>
        db.exec(
          'create table t (id integer primary key autoincrement); insert into t default values; drop table t;',
        ),
    ],
    ['only android_metadata', (db) => db.exec('create table android_metadata (locale text)')],
  ])('is set up normally for %s', async (_, prepare) => {
    const { dbName } = await createFileAdapter('node', { dbName: undefined })
    DatabaseBridge.closeAllConnections()
    cleanupDb(dbName, 'node')
    dbNames.push(dbName)
    const db = new BetterSqlite3(dbName)
    prepare(db)
    db.close()

    const { adapter } = await openFileAdapter(dbName)
    expect(await adapter.count(taskQuery())).toBe(0)
  })

  it('with a Database and seed: readyPromise rejects, and unsafeResetDatabase() makes it ready and seeded', async () => {
    const { dbName } = await createFileAdapter('node', { schema: testSchema })
    dbNames.push(dbName)
    DatabaseBridge.closeAllConnections()
    setUserVersion(dbName, 0)

    const run = jest.fn(async (db) => {
      await db.get('mock_tasks').create((task) => {
        task.name = 'seeded'
      })
    })
    const database = new Database({
      adapter: new SQLiteAdapter({ dbName, schema: testSchema }),
      modelClasses,
      seed: databaseSeed({ steps: [{ schemaVersion: 1, run }] }),
    })
    await expect(database.readyPromise).rejects.toThrow(TABLES_WITHOUT_VERSION)
    expect(database.isReady).toBe(false)

    await database.write(() => database.unsafeResetDatabase())

    await expect(database.readyPromise).resolves.toBeUndefined()
    expect(database.isReady).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(await database.get('mock_tasks').query().fetchCount()).toBe(1)
  })
})

describe('SQLite adapter (Node): unsafeResetDatabase() after any failed setup', () => {
  it('recovers from a failed migration', async () => {
    const { dbName } = await createFileAdapter('node')
    dbNames.push(dbName)
    DatabaseBridge.closeAllConnections()
    const schema = { ...testSchemaForTasks(), version: 2 }
    const migrations = schemaMigrations({
      migrations: [{ toVersion: 2, steps: [unsafeExecuteSql('this is not sql;')] }],
    })
    const adapter = new SQLiteAdapter({ dbName, schema, migrations })
    await expect(adapter.initializingPromise).rejects.toThrow(/syntax error/)

    await new Promise((resolve, reject) =>
      adapter.unsafeResetDatabase((result) => (result.error ? reject(result.error) : resolve())),
    )

    DatabaseBridge.closeAllConnections()
    const reopened = await openFileAdapter(dbName, { schema, migrations })
    expect(await reopened.adapter.count(taskQuery())).toBe(0)
  })
})

// The adapter test schema (`tasks` etc.) that createFileAdapter uses
function testSchemaForTasks() {
  // eslint-disable-next-line global-require
  return require('../../../__tests__/helpers').testSchema
}

// Runs `fn` with every Node SQLite connection's busy timeout set to `ms`, restoring it afterwards
async function withBusyTimeout(ms, fn) {
  const DatabaseClass = require('../Database').default // eslint-disable-line global-require
  const originalOpen = DatabaseClass.prototype.open
  DatabaseClass.prototype.open = function open() {
    originalOpen.call(this)
    this.instance.pragma(`busy_timeout = ${ms}`)
  }
  try {
    return await fn()
  } finally {
    DatabaseClass.prototype.open = originalOpen
  }
}
