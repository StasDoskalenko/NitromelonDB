import DatabaseDriver from './DatabaseDriver'

const SQLITE_DONE = 101

class FakeSqliteApi {
  constructor() {
    this.nextStatement = 1
    this.statementsById = new Map()
    this.executed = []
    this.inTransaction = false
  }

  statements(_db, sql) {
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
          this.statementsById.set(id, { sql: parts[index++], args: [] })
          return { done: false, value: id }
        },
      }),
    }
  }

  bind_collection(id, args) {
    this.statementsById.get(id).args = args
    return 0
  }

  async step(id) {
    const state = this.statementsById.get(id)
    this.executed.push(state)
    if (state.sql.startsWith('BEGIN')) this.inTransaction = true
    if (state.sql.startsWith('COMMIT') || state.sql.startsWith('ROLLBACK')) {
      this.inTransaction = false
    }
    if (state.sql.includes('missing_table')) throw new Error('no such table')
    return SQLITE_DONE
  }

  row() {
    return []
  }

  column_names() {
    return []
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
})
