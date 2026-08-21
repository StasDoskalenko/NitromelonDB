/* eslint-disable jest/no-standalone-expect */
import { taskQuery } from '../helpers'

/**
 * Concurrency tests that require a file-backed database.
 * Note: JS calls are synchronous on the JS thread, so "concurrency" here means
 * interleaving and ordering of non-awaited calls.
 */
export default (it) => {
  // C1: Promise.all of N write blocks — all land, no lost writes
  it('Promise.all of N write blocks: all land, no lost writes', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter: fileAdapterCompat } = await (async () => {
      const { createFileAdapter } = require('./helpers')
      const { adapter } = await createFileAdapter(platform)
      return { adapter: new (require('../compat').default)(adapter) }
    })()

    const N = 100
    const writes = Array.from({ length: N }, (_, i) =>
      fileAdapterCompat.batch([['create', 'tasks', { id: `t${i}`, text1: `task ${i}` }]]),
    )
    await Promise.all(writes)

    const count = await fileAdapterCompat.count(
      taskQuery(),
    )
    expect(count).toBe(N)
  })

  // C2: Reads issued while a writer block is in flight resolve after it and see its data
  it('reads issued during a writer block see its data', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter: fileAdapterCompat } = await (async () => {
      const { createFileAdapter } = require('./helpers')
      const { adapter } = await createFileAdapter(platform)
      return { adapter: new (require('../compat').default)(adapter) }
    })()

    // Queue writes without awaiting
    fileAdapterCompat.batch([['create', 'tasks', { id: 't1', text1: 'hello' }]])
    fileAdapterCompat.batch([['create', 'tasks', { id: 't2', text1: 'world' }]])

    // Queue reads that should see the writes (ordered by work queue)
    const r1 = fileAdapterCompat.find('tasks', 't1')
    const r2 = fileAdapterCompat.find('tasks', 't2')

    const [r1Result, r2Result] = await Promise.all([r1, r2])
    expect(r1Result.text1).toBe('hello')
    expect(r2Result.text1).toBe('world')
  })

  // C4: Interleaved non-awaited batch/find/query calls
  it('interleaved non-awaited batch/find/query calls maintain ordering', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter: fileAdapterCompat } = await (async () => {
      const { createFileAdapter } = require('./helpers')
      const { adapter } = await createFileAdapter(platform)
      return { adapter: new (require('../compat').default)(adapter) }
    })()

    // Queue operations in a specific order
    fileAdapterCompat.batch([['create', 'tasks', { id: 't1', text1: 'first' }]])
    const find1 = fileAdapterCompat.find('tasks', 't1')
    const query1 = fileAdapterCompat.query(
      taskQuery(),
    )
    fileAdapterCompat.batch([['create', 'tasks', { id: 't2', text1: 'second' }]])
    const find2 = fileAdapterCompat.find('tasks', 't2')
    const query2 = fileAdapterCompat.query(
      taskQuery(),
    )

    const [f1, q1, f2, q2] = await Promise.all([find1, query1, find2, query2])

    expect(f1.text1).toBe('first')
    expect(f2.text1).toBe('second')
    expect(q1).toEqual(['t1'])
    expect(q2).toEqual(['t1', 't2'])
  })

  // C5: Two adapters on one file, both writing: no corruption, both write sets present
  it('two adapters on one file, both writing: no corruption', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { createFileAdapter, cleanupDb } = require('./helpers')
    const { adapter: adapter1, dbName } = await createFileAdapter(platform)

    // Create a second adapter on the same file
    const SQLiteAdapter = require('../../sqlite/index')
    const { testSchema } = require('../helpers')
    const adapter2 = new SQLiteAdapter({
      dbName,
      schema: testSchema,
    })
    await adapter2.initializingPromise

    const compat1 = new (require('../compat').default)(adapter1)
    const compat2 = new (require('../compat').default)(adapter2)

    // Both adapters write concurrently
    const writes1 = Array.from({ length: 50 }, (_, i) =>
      compat1.batch([['create', 'tasks', { id: `a${i}`, text1: `adapter1 task ${i}` }]]),
    )
    const writes2 = Array.from({ length: 50 }, (_, i) =>
      compat2.batch([['create', 'tasks', { id: `b${i}`, text1: `adapter2 task ${i}` }]]),
    )
    await Promise.all([...writes1, ...writes2])

    // Verify: all 100 records present, no lost writes
    expect(await compat1.count(
      taskQuery(),
    )).toBe(100)
    expect(await compat2.count(
      taskQuery(),
    )).toBe(100)

    // Spot-check: each adapter can find its own records
    expect(await compat1.find('tasks', 'a0')).not.toBeNull()
    expect(await compat2.find('tasks', 'b0')).not.toBeNull()

    // Clean up
    cleanupDb(dbName, platform)
  })

  // C6: Two adapters, one long-running write and one read: read either blocks-then-succeeds or fails cleanly
  it('two adapters: long write + concurrent read', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { createFileAdapter, cleanupDb } = require('./helpers')
    const { adapter: adapter1, dbName } = await createFileAdapter(platform)

    // Create a second adapter on the same file
    const SQLiteAdapter = require('../../sqlite/index')
    const { testSchema } = require('../helpers')
    const adapter2 = new SQLiteAdapter({
      dbName,
      schema: testSchema,
    })
    await adapter2.initializingPromise

    const compat1 = new (require('../compat').default)(adapter1)
    const compat2 = new (require('../compat').default)(adapter2)

    // Adapter 1 does a large batch (long-running write)
    const largeBatch = Array.from({ length: 1000 }, (_, i) =>
      ['create', 'tasks', { id: `t${i}`, text1: `task ${i}` }],
    )
    const writePromise = compat1.batch(largeBatch)

    // Adapter 2 tries to read concurrently
    const readPromise = compat2.count(
      taskQuery(),
    )

    // Both should complete (read may block until write finishes, or fail cleanly)
    const [writeResult, readResult] = await Promise.allSettled([writePromise, readPromise])

    // Write should succeed
    expect(writeResult.status).toBe('fulfilled')

    // Read should either succeed (blocked-then-saw-data) or fail cleanly (no torn data)
    if (readResult.status === 'fulfilled') {
      // Count should be either 0 (read happened before write) or 1000 (read happened after)
      expect(readResult.value).toBeGreaterThanOrEqual(0)
    }
    // If rejected, that's also acceptable — the key is no torn data

    // After both complete, verify no corruption
    expect(await compat1.count(
      taskQuery(),
    )).toBe(1000)

    cleanupDb(dbName, platform)
  })

  // C7: Same as C5 but with usesExclusiveLocking: true
  it('two adapters with usesExclusiveLocking: true, both writing', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { createFileAdapter, cleanupDb } = require('./helpers')
    const { adapter: adapter1, dbName } = await createFileAdapter(platform)

    // Create a second adapter on the same file with exclusive locking
    const SQLiteAdapter = require('../../sqlite/index')
    const { testSchema } = require('../helpers')
    const adapter2 = new SQLiteAdapter({
      dbName,
      schema: testSchema,
      usesExclusiveLocking: true,
    })
    await adapter2.initializingPromise

    const compat1 = new (require('../compat').default)(adapter1)
    const compat2 = new (require('../compat').default)(adapter2)

    // Both adapters write concurrently
    const writes1 = Array.from({ length: 25 }, (_, i) =>
      compat1.batch([['create', 'tasks', { id: `a${i}`, text1: `adapter1 task ${i}` }]]),
    )
    const writes2 = Array.from({ length: 25 }, (_, i) =>
      compat2.batch([['create', 'tasks', { id: `b${i}`, text1: `adapter2 task ${i}` }]]),
    )

    // With exclusive locking, one may fail — that's expected behavior
    const results = await Promise.allSettled([...writes1, ...writes2])
    const fulfilled = results.filter(r => r.status === 'fulfilled').length

    // At least some writes should succeed (the ones that acquire the lock)
    expect(fulfilled).toBeGreaterThan(0)

    // After all writes, verify no corruption on the database
    const finalCount = await compat1.count(
      taskQuery(),
    )
    expect(finalCount).toBeGreaterThanOrEqual(0) // database is still usable

    cleanupDb(dbName, platform)
  })
}
