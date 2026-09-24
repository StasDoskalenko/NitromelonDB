import { testSchema } from '../__tests__/helpers'
import SQLiteAdapter from './index'

// Large batches may ask the database for row counts first, to decide whether to drop and recreate
// indices (see SQLiteAdapter#_tablesToReindex). Whatever it decides, the batch must reach the
// database in call order: a read issued right after batch() must never run before it.

const creates = (count) =>
  Array.from({ length: count }, (_, i) => ['create', 'tasks', { id: `t${i}`, text1: `task ${i}` }])

// Records every call in the order it reaches the "database". `answer` decides how count() replies.
function recordingDispatcher(answer) {
  const sent = []
  const pending = []
  return {
    sent,
    flush: () => pending.splice(0).forEach((reply) => reply()),
    call(method, args, callback) {
      sent.push({ method, args })
      const reply = () => callback({ value: method === 'count' ? 0 : undefined })
      if (method === 'count' && answer === 'sync') {
        reply()
      } else {
        pending.push(reply)
      }
    },
  }
}

async function adapterWith(dispatcher, dispatcherType) {
  const adapter = new SQLiteAdapter({ schema: testSchema })
  await adapter.initializingPromise
  adapter._dispatcher = dispatcher
  adapter._dispatcherType = dispatcherType
  return adapter
}

const dropsIndices = (batchCall) => batchCall.args[0].some(([, , sql]) => sql.startsWith('drop index'))

describe('SQLiteAdapter large batch ordering', () => {
  it('web: sends the batch immediately, before a read issued right after it, and never reindexes', async () => {
    const dispatcher = recordingDispatcher('async')
    const adapter = await adapterWith(dispatcher, 'wa-sqlite')

    adapter.batch(creates(1500), () => {})
    adapter.find('tasks', 't1', () => {})

    expect(dispatcher.sent.map((call) => call.method)).toEqual(['batch', 'find'])
    expect(dropsIndices(dispatcher.sent[0])).toBe(false)
  })

  it('async dispatcher: does not wait for counts, so later calls cannot overtake the batch', async () => {
    const dispatcher = recordingDispatcher('async')
    const adapter = await adapterWith(dispatcher, 'asynchronous')

    adapter.batch(creates(1500), () => {})
    adapter.find('tasks', 't1', () => {})
    // the late count reply must not change anything
    dispatcher.flush()

    expect(dispatcher.sent.map((call) => call.method)).toEqual(['count', 'batch', 'find'])
    expect(dropsIndices(dispatcher.sent[1])).toBe(false)
  })

  it('sync dispatcher: uses the count, and the batch still goes out before later calls', async () => {
    const dispatcher = recordingDispatcher('sync')
    const adapter = await adapterWith(dispatcher, 'nitro')

    adapter.batch(creates(1500), () => {})
    adapter.find('tasks', 't1', () => {})

    expect(dispatcher.sent.map((call) => call.method)).toEqual(['count', 'batch', 'find'])
    // empty table (count 0) and 1500 operations: rebuilding indices is the faster path
    expect(dropsIndices(dispatcher.sent[1])).toBe(true)
  })

  it('small batches never ask for counts', async () => {
    const dispatcher = recordingDispatcher('sync')
    const adapter = await adapterWith(dispatcher, 'nitro')

    adapter.batch(creates(999), () => {})

    expect(dispatcher.sent.map((call) => call.method)).toEqual(['batch'])
    expect(dropsIndices(dispatcher.sent[0])).toBe(false)
  })
})
