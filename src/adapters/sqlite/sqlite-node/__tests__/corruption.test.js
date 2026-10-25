import fs from 'fs'
import BetterSqlite3 from 'better-sqlite3'
import {
  createFileAdapter,
  openFileAdapter,
  cleanupDb,
} from '../../../__tests__/sqliteTests/helpers'
import { taskQuery, mockTaskRaw, testSchema } from '../../../__tests__/helpers'
import DatabaseBridge from '../DatabaseBridge'
import SQLiteAdapter from '../..'
import DatabaseAdapterCompat from '../../../compat'

// What the SQLite adapter does with a damaged database file, through its public API. Node-only:
// the shared adapter tests also run on devices, where JS can't reach the database file.

const ROWS = 300

let dbNames = []

afterEach(() => {
  dbNames.forEach((dbName) => cleanupDb(dbName, 'node'))
  dbNames = []
})

async function databaseWithTasks() {
  const { adapter, dbName } = await createFileAdapter('node')
  dbNames.push(dbName)
  await adapter.batch(
    Array.from({ length: ROWS }, (_, i) => [
      'create',
      'tasks',
      mockTaskRaw({ id: `t${i}`, text1: `task ${i} ${'x'.repeat(300)}` }),
    ]),
  )
  DatabaseBridge.closeAllConnections()
  return dbName
}

// Overwrites the start of each page (after its header) belonging to `objects` and of `type`
function damagePages(dbName, { objects, pageType, count }) {
  const db = new BetterSqlite3(dbName, { readonly: true })
  const pageSize = db.pragma('page_size', { simple: true })
  const pages = db
    .prepare('select name, pageno, pagetype from dbstat order by pageno')
    .all()
    .filter(({ name, pagetype }) => objects(name) && (!pageType || pagetype === pageType))
    .map(({ pageno }) => pageno)
  db.close()
  expect(pages.length).toBeGreaterThan(count)

  const file = fs.readFileSync(dbName)
  pages.slice(1, count + 1).forEach((pageno) => {
    const start = (pageno - 1) * pageSize
    file.fill(0xee, start + 8, start + 300)
  })
  fs.writeFileSync(dbName, file)
}

async function expectResetRecovers(adapter) {
  await adapter.unsafeResetDatabase()
  expect(await adapter.count(taskQuery())).toBe(0)
  await adapter.batch([['create', 'tasks', mockTaskRaw({ id: 'after_reset' })]])
  expect(await adapter.query(taskQuery())).toHaveLength(1)

  // And it stays healthy across a reopen
  DatabaseBridge.closeAllConnections()
  const reopened = await openFileAdapter(adapter.dbName)
  expect(await reopened.adapter.count(taskQuery())).toBe(1)
}

// An adapter whose setup failed: unsafeResetDatabase() is how the app starts over
async function adapterWhoseSetUpFails(dbName, error) {
  const underlying = new SQLiteAdapter({ dbName, schema: testSchema })
  await expect(underlying.initializingPromise).rejects.toThrow(error)
  return new DatabaseAdapterCompat(underlying)
}

describe('SQLite adapter (Node) with a damaged database file', () => {
  it('damaged table pages: opens, some reads fail, and unsafeResetDatabase() recovers', async () => {
    const dbName = await databaseWithTasks()
    damagePages(dbName, { objects: (name) => name === 'tasks', pageType: 'leaf', count: 2 })

    const { adapter } = await openFileAdapter(dbName)
    await expect(adapter.query(taskQuery())).rejects.toThrow(/malformed/)

    await expectResetRecovers(adapter)
  })

  it('damaged index pages: opens, some reads and writes fail, and unsafeResetDatabase() recovers', async () => {
    const dbName = await databaseWithTasks()
    damagePages(dbName, { objects: (name) => name.startsWith('tasks_'), count: 2 })

    const { adapter } = await openFileAdapter(dbName)
    await expect(adapter.count(taskQuery())).rejects.toThrow(/malformed/)
    await expect(adapter.batch([['create', 'tasks', mockTaskRaw({ id: 'more' })]])).rejects.toThrow(
      /malformed/,
    )

    await expectResetRecovers(adapter)
  })

  it('a file that is not a database: opening fails, and unsafeResetDatabase() recovers', async () => {
    const dbName = await databaseWithTasks()
    fs.writeFileSync(dbName, Buffer.alloc(16384, 0x41))

    const adapter = await adapterWhoseSetUpFails(dbName, /file is not a database/)
    await expectResetRecovers(adapter)
  })

  it('a truncated file: opening fails, and unsafeResetDatabase() recovers', async () => {
    const dbName = await databaseWithTasks()
    fs.truncateSync(dbName, fs.statSync(dbName).size / 2)

    const adapter = await adapterWhoseSetUpFails(dbName, /malformed/)
    await expectResetRecovers(adapter)
  })
})
