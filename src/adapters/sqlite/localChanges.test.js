import { appSchema, tableSchema } from '../../Schema'
import SQLiteAdapter from './index'

// tablesWithLocalChanges() asks about many tables in one compound select, split into chunks that
// stay under SQLite's 500-term limit. Real-database behavior is covered in
// ../__tests__/sqliteTests/localChanges.js; this covers chunking and error handling.

const tableNames = (count) => Array.from({ length: count }, (_, i) => `table_${i}`)

const schemaWith = (tables) =>
  appSchema({
    version: 1,
    tables: tables.map((name) =>
      tableSchema({ name, columns: [{ name: 'title', type: 'string' }] }),
    ),
  })

// Replies to queryIds with the tables listed in `dirty` that appear in the SQL
function fakeDispatcher(dirty, { failOnCall } = {}) {
  const calls = []
  return {
    calls,
    call(method, [sql], callback) {
      calls.push({ method, sql })
      if (failOnCall === calls.length) {
        callback({ error: new Error('boom') })
        return
      }
      const asked = [...sql.matchAll(/select '([^']+)' as id/g)].map((match) => match[1])
      callback({ value: asked.filter((table) => dirty.includes(table)) })
    },
  }
}

async function adapterFor(tables, dispatcher) {
  const adapter = new SQLiteAdapter({ schema: schemaWith(tables) })
  await adapter.initializingPromise
  adapter._dispatcher = dispatcher
  return adapter
}

const tablesWithLocalChanges = (adapter, tables) =>
  new Promise((resolve, reject) => {
    adapter.tablesWithLocalChanges(tables, (result) =>
      result.error ? reject(result.error) : resolve(result.value),
    )
  })

describe('SQLiteAdapter.tablesWithLocalChanges', () => {
  it('asks about every table in as few queries as the compound-select limit allows', async () => {
    const tables = tableNames(450)
    const dispatcher = fakeDispatcher(['table_3', 'table_420'])
    const adapter = await adapterFor(tables, dispatcher)

    expect(await tablesWithLocalChanges(adapter, tables)).toEqual(['table_3', 'table_420'])
    expect(dispatcher.calls.map((call) => call.method)).toEqual(['queryIds', 'queryIds'])
    const termsPerQuery = dispatcher.calls.map((call) => call.sql.split(' union all ').length)
    expect(termsPerQuery).toEqual([400, 50])
    expect(Math.max(...termsPerQuery)).toBeLessThan(500)
  })

  it('makes no query for no tables', async () => {
    const dispatcher = fakeDispatcher([])
    const adapter = await adapterFor(tableNames(3), dispatcher)
    expect(await tablesWithLocalChanges(adapter, [])).toEqual([])
    expect(dispatcher.calls).toEqual([])
  })

  it('reports a failed chunk once, and nothing else', async () => {
    const tables = tableNames(900)
    const dispatcher = fakeDispatcher(tables, { failOnCall: 1 })
    const adapter = await adapterFor(tables, dispatcher)
    const callback = jest.fn()
    adapter.tablesWithLocalChanges(tables, callback)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0].error.message).toBe('boom')
  })
})
