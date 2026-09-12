import DatabaseDriver from '../DatabaseDriver'
import Database from '../Database'

// Exercises DatabaseDriver#destroyMatching() against a real better-sqlite3 engine (not a mock),
// since its whole point is reusing the passed-in `sql` as an inline derived table inside the
// actual DELETE/UPDATE statement (`where "id" in (select "id" from (<sql>))`) -- this is the one
// backend where that SQL can be validated against a real SQLite implementation in CI.

function makeDriver() {
  const driver = new DatabaseDriver()
  driver.database = new Database(':memory:')
  driver.database.executeStatements(
    'create table "tasks" ("id" text primary key, "_status" text, "_changed" text, "name" text);',
  )
  return driver
}

function insertTask(driver, id, name) {
  driver.database.execute(
    'insert into "tasks" ("id", "_status", "_changed", "name") values (?, ?, ?, ?)',
    [id, 'synced', '', name],
  )
}

function allTasks(driver) {
  return driver.database.queryRaw('select * from "tasks"')
}

describe('NodeJS DatabaseDriver#destroyMatching', () => {
  it('permanently destroys only matching records, reusing the query as a subquery', () => {
    const driver = makeDriver()
    insertTask(driver, 't1', 'foo')
    insertTask(driver, 't2', 'foo')
    insertTask(driver, 't3', 'bar')

    const sql = 'select "tasks".* from "tasks" where "tasks"."name" is ?'
    const ids = driver.destroyMatching('tasks', sql, ['foo'], true, false)

    expect(ids.slice().sort()).toEqual(['t1', 't2'])
    expect(allTasks(driver).map((row) => row.id)).toEqual(['t3'])
  })

  it('marks only matching records as deleted, reusing the query as a subquery', () => {
    const driver = makeDriver()
    insertTask(driver, 't1', 'foo')
    insertTask(driver, 't2', 'bar')

    const sql = 'select "tasks".* from "tasks" where "tasks"."name" is ?'
    const ids = driver.destroyMatching('tasks', sql, ['foo'], false, false)

    expect(ids).toEqual(['t1'])
    const rows = allTasks(driver)
    expect(rows.find((row) => row.id === 't1')._status).toBe('deleted')
    expect(rows.find((row) => row.id === 't2')._status).toBe('synced')
  })

  it('destroys everything via a bare statement when isUnconditional is true', () => {
    const driver = makeDriver()
    insertTask(driver, 't1', 'foo')
    insertTask(driver, 't2', 'bar')

    const ids = driver.destroyMatching('tasks', 'select "tasks".* from "tasks"', [], true, true)

    expect(ids.slice().sort()).toEqual(['t1', 't2'])
    expect(allTasks(driver)).toEqual([])
  })

  it('marks everything as deleted via a bare statement when isUnconditional is true', () => {
    const driver = makeDriver()
    insertTask(driver, 't1', 'foo')
    insertTask(driver, 't2', 'bar')

    const ids = driver.destroyMatching('tasks', 'select "tasks".* from "tasks"', [], false, true)

    expect(ids.slice().sort()).toEqual(['t1', 't2'])
    expect(allTasks(driver).every((row) => row._status === 'deleted')).toBe(true)
  })

  it('returns an empty array and changes nothing when nothing matches', () => {
    const driver = makeDriver()
    insertTask(driver, 't1', 'foo')

    const sql = 'select "tasks".* from "tasks" where "tasks"."name" is ?'
    const ids = driver.destroyMatching('tasks', sql, ['nope'], true, false)

    expect(ids).toEqual([])
    expect(allTasks(driver)).toHaveLength(1)
  })

  it('removes destroyed ids from the "already sent to JS" cache', () => {
    const driver = makeDriver()
    insertTask(driver, 't1', 'foo')
    driver.markAsCached('tasks', 't1')
    expect(driver.isCached('tasks', 't1')).toBe(true)

    driver.destroyMatching(
      'tasks',
      'select "tasks".* from "tasks" where "tasks"."id" is ?',
      ['t1'],
      true,
      false,
    )

    expect(driver.isCached('tasks', 't1')).toBe(false)
  })
})
