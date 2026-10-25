import fs from 'fs'
import BetterSqlite3 from 'better-sqlite3'
import DatabaseDriver, { RESET_ID_KEY } from '../DatabaseDriver'
import { encodeSchema } from '../../encodeSchema'
import { testSchema } from '../../../__tests__/helpers'

// DatabaseDriver#unsafeResetDatabase wipes the database and sets up the new schema in one
// transaction, so other connections to the file never see it without tables (#172)

const schema = { sql: encodeSchema(testSchema), version: testSchema.version }

let paths = []
let connections = []

function tempPath() {
  if (!fs.existsSync('.tmp')) {
    fs.mkdirSync('.tmp')
  }
  const path = `${process.cwd()}/.tmp/reset${Math.random()}.db`
  paths.push(path)
  return path
}

function setUpDriver(path) {
  const driver = new DatabaseDriver()
  driver.setUpWithSchema(path, schema.sql, schema.version)
  connections.push(driver.database.instance)
  return driver
}

function connect(path) {
  const connection = new BetterSqlite3(path)
  connections.push(connection)
  return connection
}

const resetId = (connection) =>
  connection.prepare('select value from local_storage where key = ?').get(RESET_ID_KEY)?.value

afterEach(() => {
  connections.forEach((connection) => connection.open && connection.close())
  connections = []
  paths.forEach((path) => {
    ;['', '-wal', '-shm', '-journal'].forEach((suffix) => {
      if (fs.existsSync(path + suffix)) fs.unlinkSync(path + suffix)
    })
  })
  paths = []
})

describe('sqlite-node DatabaseDriver#unsafeResetDatabase', () => {
  it('another connection never sees the database without its schema, mid-reset', () => {
    const path = tempPath()
    const driver = setUpDriver(path)
    driver.database.execute(`insert into tasks (id) values ('t1')`)
    const other = connect(path)

    // After every statement the reset runs (and after every transaction it commits), look at the
    // database from the other connection
    const seen = []
    const probe = () => {
      try {
        const { count } = other.prepare('select count(*) as count from tasks').get()
        seen.push({ count, version: other.pragma('user_version', { simple: true }) })
      } catch (error) {
        seen.push({ error: error.message })
      }
    }
    const instrument = (object, methods) =>
      methods.forEach((method) => {
        const original = object[method].bind(object)
        object[method] = (...args) => {
          const result = original(...args)
          probe()
          return result
        }
      })
    instrument(driver.database, ['execute', 'executeStatements', 'queryRaw', 'inTransaction'])
    instrument(driver.database.instance, ['exec', 'pragma'])

    driver.unsafeResetDatabase(schema)

    expect(seen.filter(({ error }) => error)).toEqual([])
    expect(seen.every(({ version }) => version === schema.version)).toBe(true)
    // The old data until the reset commits, then the new, empty database -- nothing in between
    const counts = seen.map(({ count }) => count)
    expect(counts[0]).toBe(1)
    expect(counts[counts.length - 1]).toBe(0)
    expect(counts.slice(counts.indexOf(0)).every((count) => count === 0)).toBe(true)
  })

  it('leaves the old database as it was if setting up the new schema fails', () => {
    const path = tempPath()
    const driver = setUpDriver(path)
    driver.database.execute(`insert into tasks (id) values ('t1')`)
    const idBefore = resetId(driver.database.instance)

    expect(() =>
      driver.unsafeResetDatabase({ sql: `${schema.sql} this is not sql;`, version: 2 }),
    ).toThrow(/syntax error/)

    const other = connect(path)
    expect(other.prepare('select id from tasks').all()).toEqual([{ id: 't1' }])
    expect(other.pragma('user_version', { simple: true })).toBe(schema.version)
    expect(resetId(other)).toBe(idBefore)
  })

  it('writes a new reset ID on every reset', () => {
    const path = tempPath()
    const driver = setUpDriver(path)
    const first = resetId(driver.database.instance)
    expect(first).toEqual(expect.any(String))

    driver.unsafeResetDatabase(schema)
    const second = resetId(connect(path))

    expect(second).toEqual(expect.any(String))
    expect(second).not.toBe(first)
  })

  it('sets up the schema and reset ID after recreating a corrupt file', () => {
    const path = tempPath()
    fs.writeFileSync(path, Buffer.alloc(8192, 0x41))

    const driver = setUpDriver(path)

    expect(driver.database.userVersion).toBe(schema.version)
    expect(driver.database.queryRaw('select count(*) as count from tasks')).toEqual([{ count: 0 }])
    expect(resetId(driver.database.instance)).toEqual(expect.any(String))
  })
})
