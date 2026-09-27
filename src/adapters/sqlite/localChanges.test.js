import { appSchema, tableSchema } from '../../Schema'
import SQLiteAdapter from './index'

// tablesWithLocalChanges() sends one query per chunk of tables (see encodeLocalChangesQuery) and
// combines the answers. Real-database behavior is covered in ../__tests__/sqliteTests/localChanges.js;
// this covers how answers are delivered: like every other adapter method, through the callback as
// soon as the dispatcher answers, exactly once.

const tableNames = (count) => Array.from({ length: count }, (_, i) => `table_${i}`)

const schemaWith = (tables) =>
  appSchema({
    version: 1,
    tables: tables.map((name) =>
      tableSchema({ name, columns: [{ name: 'title', type: 'string' }] }),
    ),
  })

const askedTables = (sql) => [...sql.matchAll(/select '([^']+)' as id/g)].map((match) => match[1])

// Answers queryIds with the tables in `dirty` that the SQL asks about. Synchronously, like Nitro,
// unless `deferred` -- then replies wait until flush(), which can deliver them in any order.
function fakeDispatcher(dirty, { failOnCall, deferred = false } = {}) {
  const calls = []
  const pending = []
  return {
    calls,
    flush(order = (replies) => replies) {
      order(pending.splice(0)).forEach((reply) => reply())
    },
    call(method, [sql], callback) {
      calls.push({ method, sql })
      const callNumber = calls.length
      const reply = () =>
        failOnCall === callNumber
          ? callback({ error: new Error(`chunk ${callNumber} failed`) })
          : callback({ value: askedTables(sql).filter((table) => dirty.includes(table)) })
      if (deferred) {
        pending.push(reply)
      } else {
        reply()
      }
    },
  }
}

async function adapterFor(tables, dispatcher) {
  const adapter = new SQLiteAdapter({ schema: schemaWith(tables) })
  await adapter.initializingPromise
  adapter._dispatcher = dispatcher
  return adapter
}

describe('SQLiteAdapter.tablesWithLocalChanges', () => {
  it('asks about up to 400 tables in one query, answered synchronously by a synchronous dispatcher', async () => {
    const tables = tableNames(400)
    const dispatcher = fakeDispatcher(['table_7'])
    const adapter = await adapterFor(tables, dispatcher)
    const callback = jest.fn()
    adapter.tablesWithLocalChanges(tables, callback)
    expect(dispatcher.calls).toHaveLength(1)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({ value: ['table_7'] })
  })

  it('splits more tables into chunks, still answering synchronously', async () => {
    const tables = tableNames(900)
    const dispatcher = fakeDispatcher(['table_3', 'table_420', 'table_899'])
    const adapter = await adapterFor(tables, dispatcher)
    const callback = jest.fn()
    adapter.tablesWithLocalChanges(tables, callback)
    expect(dispatcher.calls.map((call) => askedTables(call.sql).length)).toEqual([400, 400, 100])
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({ value: ['table_3', 'table_420', 'table_899'] })
  })

  it('sends every chunk before any answer, and combines answers that arrive out of order', async () => {
    const tables = tableNames(900)
    const dispatcher = fakeDispatcher(['table_3', 'table_420', 'table_899'], { deferred: true })
    const adapter = await adapterFor(tables, dispatcher)
    const callback = jest.fn()
    adapter.tablesWithLocalChanges(tables, callback)
    expect(dispatcher.calls).toHaveLength(3) // all sent back to back
    expect(callback).not.toHaveBeenCalled()
    dispatcher.flush((replies) => [...replies].reverse())
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({ value: ['table_3', 'table_420', 'table_899'] })
  })

  it('answers once with the first error, ignoring later answers', async () => {
    const tables = tableNames(900)
    const dispatcher = fakeDispatcher(tables, { failOnCall: 2, deferred: true })
    const adapter = await adapterFor(tables, dispatcher)
    const callback = jest.fn()
    adapter.tablesWithLocalChanges(tables, callback)
    dispatcher.flush((replies) => [replies[1], replies[0], replies[2]])
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0].error.message).toBe('chunk 2 failed')
  })

  it('answers no tables with none, without querying', async () => {
    const dispatcher = fakeDispatcher([])
    const adapter = await adapterFor(tableNames(3), dispatcher)
    const callback = jest.fn()
    adapter.tablesWithLocalChanges([], callback)
    expect(callback).toHaveBeenCalledWith({ value: [] })
    expect(dispatcher.calls).toEqual([])
  })

  it('throws for a table that is not in the schema, before querying', async () => {
    const dispatcher = fakeDispatcher([])
    const adapter = await adapterFor(tableNames(2), dispatcher)
    expect(() => adapter.tablesWithLocalChanges(['table_0', 'nope'], () => {})).toThrow()
    expect(dispatcher.calls).toEqual([])
  })
})
