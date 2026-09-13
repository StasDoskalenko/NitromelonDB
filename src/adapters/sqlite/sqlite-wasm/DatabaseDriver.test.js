import DatabaseDriver from './DatabaseDriver'

const SQLITE_ROW = 100
const SQLITE_DONE = 101

class FakeSqliteApi {
  constructor() {
    this.nextStatement = 1
    this.statementsById = new Map()
    this.executed = []
    this.finalized = []
    this.inTransaction = false
    // Rows to hand back to the next SELECT statement, in call order -- see queueRows().
    this.pendingRows = []
  }

  // Queues the row objects (e.g. [{ id: 'a' }]) that the next SELECT statement's
  // step()/row()/column_names() calls should surface, so tests can drive queryRaw()-based
  // methods like destroyMatching() through their row-returning branch.
  queueRows(rows) {
    this.pendingRows.push(rows)
  }

  statements(_db, sql, _options) {
    const parts = sql
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
    let index = 0
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (index >= parts.length) return { done: true }
          const id = this.nextStatement++
          const partSql = parts[index++]
          const rows = /^select/i.test(partSql) ? this.pendingRows.shift() ?? [] : null
          this.statementsById.set(id, { sql: partSql, args: [], rows, rowIndex: 0, columns: [] })
          return { done: false, value: id }
        },
      }),
    }
  }

  async finalize(id) {
    this.finalized.push(id)
    this.statementsById.delete(id)
    return 0
  }

  bind_collection(id, args) {
    this.statementsById.get(id).args = args
    return this.bindResult ?? 0
  }

  async step(id) {
    const state = this.statementsById.get(id)
    this.executed.push(state)
    if (state.sql.startsWith('BEGIN')) this.inTransaction = true
    if (state.sql.startsWith('COMMIT') || state.sql.startsWith('ROLLBACK')) {
      this.inTransaction = false
    }
    if (state.sql.includes('missing_table')) throw new Error('no such table')
    if (state.rows && state.rowIndex < state.rows.length) {
      state.rowIndex += 1
      return SQLITE_ROW
    }
    return SQLITE_DONE
  }

  row(id) {
    const state = this.statementsById.get(id)
    const record = state.rows[state.rowIndex - 1]
    return state.columns.map((column) => record[column])
  }

  column_names(id) {
    const state = this.statementsById.get(id)
    state.columns = state.rows && state.rows.length ? Object.keys(state.rows[0]) : []
    return state.columns
  }

  get_autocommit() {
    return this.inTransaction ? 0 : 1
  }

  async close() {
    return 0
  }
}

function makeDriver() {
  const api = new FakeSqliteApi()
  return { api, driver: new DatabaseDriver(api, 1) }
}

describe('wa-sqlite DatabaseDriver contract', () => {
  it('surfaces non-success parameter binding results and finalizes the statement', async () => {
    const { api, driver } = makeDriver()
    api.bindResult = 25

    await expect(driver.execute('select ?', ['value'])).rejects.toThrow(
      'failed to bind query parameters (SQLite result 25)',
    )
    expect(api.statementsById.size).toBe(0)
    expect(api.finalized).toHaveLength(1)
  })

  it('normalizes booleans, commits batches, and changes cache only after commit', async () => {
    const { api, driver } = makeDriver()
    await driver.batch([
      [1, 'tasks', 'insert into tasks values (?, ?)', [['a', false]]],
    ])

    expect(api.executed.map(({ sql }) => sql)).toEqual([
      'BEGIN EXCLUSIVE TRANSACTION',
      'insert into tasks values (?, ?)',
      'COMMIT TRANSACTION',
    ])
    expect(api.executed[1].args).toEqual(['a', 0])
    expect(await driver.find('tasks', 'a')).toBe('a')
    driver.clearCachedRecords()
    expect(await driver.find('tasks', 'a')).toBeNull()

    await expect(
      driver.batch([
        [1, 'tasks', 'insert into missing_table values (?)', [['b']]],
      ]),
    ).rejects.toThrow('no such table')
    expect(await driver.find('tasks', 'b')).toBeNull()
    expect(api.executed.some(({ sql }) => sql === 'ROLLBACK TRANSACTION')).toBe(true)
    expect(api.statementsById.size).toBe(0)
    expect(api.finalized).toHaveLength(api.executed.length)
  })

  it('imports sync JSON with defaults and returns residual JSON values', async () => {
    const { api, driver } = makeDriver()
    const residual = await driver.unsafeLoadFromSync(
      JSON.stringify({
        timestamp: 123,
        changes: {
          tasks: {
            created: [{ id: 'a', name: 'From sync', unknown: 'ignored' }],
            updated: [],
            deleted: [],
          },
          unknown_table: { created: [{ id: 'x' }] },
        },
      }),
      {
        tables: {
          tasks: {
            columnArray: [
              { name: 'name', type: 'string' },
              { name: 'done', type: 'boolean' },
              { name: 'rank', type: 'number', isOptional: true },
            ],
          },
        },
      },
      'drop index task_name',
      'create index task_name',
    )

    expect(residual).toEqual({ timestamp: '123' })
    const insert = api.executed.find(({ sql }) => sql.startsWith('INSERT INTO "tasks"'))
    expect(insert.args).toEqual(['a', 'synced', '', 'From sync', 0, null])
    expect(api.executed.map(({ sql }) => sql)).toContain('COMMIT TRANSACTION')
  })

  it('rejects deleted sync records and rolls back', async () => {
    const { api, driver } = makeDriver()
    await expect(
      driver.unsafeLoadFromSync(
        JSON.stringify({ changes: { tasks: { deleted: ['a'] } } }),
        { tables: {} },
        '',
        '',
      ),
    ).rejects.toThrow('expected deleted field to be empty')
    expect(api.executed.map(({ sql }) => sql)).toContain('ROLLBACK TRANSACTION')
  })

  describe('destroyMatching', () => {
    it('resolves ids via the given select, applies the derived-table mutation, and evicts them from cache', async () => {
      const { api, driver } = makeDriver()
      await driver.batch([[1, 'tasks', 'insert into tasks values (?)', [['a']]]])
      expect(await driver.find('tasks', 'a')).toBe('a') // cached

      api.queueRows([{ id: 'a' }, { id: 'b' }])
      const ids = await driver.destroyMatching(
        'tasks',
        'select "id" from "tasks" where "archived" = ?',
        [1],
        true,
        false,
      )

      expect(ids).toEqual(['a', 'b'])
      expect(api.executed.map(({ sql }) => sql)).toEqual(
        expect.arrayContaining([
          'BEGIN EXCLUSIVE TRANSACTION',
          'select "id" from "tasks" where "archived" = ?',
          'delete from "tasks" where "id" in (select "id" from (select "id" from "tasks" where "archived" = ?))',
          'COMMIT TRANSACTION',
        ]),
      )
      const mutation = api.executed.find(({ sql }) => sql.startsWith('delete from "tasks" where'))
      expect(mutation.args).toEqual([1])

      api.queueRows([]) // no row backing the cache-miss lookup below
      expect(await driver.find('tasks', 'a')).toBeNull()
    })

    it('runs a bare mutation with no bound args when the query is unconditional', async () => {
      const { api, driver } = makeDriver()
      api.queueRows([{ id: 'x' }])

      const ids = await driver.destroyMatching('tasks', 'select "id" from "tasks"', [], true, true)

      expect(ids).toEqual(['x'])
      const mutation = api.executed.find(({ sql }) => sql === 'delete from "tasks"')
      expect(mutation).toBeDefined()
      expect(mutation.args).toEqual([])
    })

    it('marks matching rows as deleted instead of removing them when not permanent', async () => {
      const { api, driver } = makeDriver()
      api.queueRows([{ id: 'y' }])

      const ids = await driver.destroyMatching(
        'tasks',
        'select "id" from "tasks" where "num" = ?',
        [5],
        false,
        false,
      )

      expect(ids).toEqual(['y'])
      expect(
        api.executed.some(
          ({ sql }) =>
            sql ===
            'update "tasks" set "_status" = \'deleted\' where "id" in (select "id" from (select "id" from "tasks" where "num" = ?))',
        ),
      ).toBe(true)
    })

    it('skips the mutation entirely and returns an empty array when nothing matches', async () => {
      const { api, driver } = makeDriver()
      api.queueRows([])

      const ids = await driver.destroyMatching(
        'tasks',
        'select "id" from "tasks" where "num" = ?',
        [5],
        true,
        false,
      )

      expect(ids).toEqual([])
      expect(api.executed.some(({ sql }) => sql.startsWith('delete from'))).toBe(false)
      expect(api.executed.map(({ sql }) => sql)).toEqual(
        expect.arrayContaining(['BEGIN EXCLUSIVE TRANSACTION', 'COMMIT TRANSACTION']),
      )
    })
  })
})
