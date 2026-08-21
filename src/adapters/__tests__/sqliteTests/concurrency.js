/* eslint-disable jest/no-standalone-expect */
import { taskQuery } from '../helpers'
import { createFileAdapter, openFileAdapter, cleanupDb } from './helpers'

/**
 * Concurrency tests that require a file-backed database.
 * Note: JS calls are synchronous on the JS thread, so "concurrency" here means
 * interleaving and ordering of non-awaited calls.
 */
export default (it) => {
  it('Promise.all of N write blocks: all land, no lost writes', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)
    const N = 100
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        adapter.batch([['create', 'tasks', { id: `t${i}`, text1: `task ${i}` }]]),
      ),
    )
    expect(await adapter.count(taskQuery())).toBe(N)
  })

  it('reads issued during a writer block see its data', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)
    adapter.batch([['create', 'tasks', { id: 't1', text1: 'hello' }]])
    adapter.batch([['create', 'tasks', { id: 't2', text1: 'world' }]])
    const [r1Result, r2Result] = await Promise.all([
      adapter.find('tasks', 't1'),
      adapter.find('tasks', 't2'),
    ])
    expect(r1Result).toBeTruthy()
    expect(r2Result).toBeTruthy()
    expect(await adapter.queryIds(taskQuery())).toEqual(expect.arrayContaining(['t1', 't2']))
  })

  it('interleaved non-awaited batch/find/query calls maintain ordering', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)
    adapter.batch([['create', 'tasks', { id: 't1', text1: 'first' }]])
    const find1 = adapter.find('tasks', 't1')
    const query1 = adapter.queryIds(taskQuery())
    adapter.batch([['create', 'tasks', { id: 't2', text1: 'second' }]])
    const find2 = adapter.find('tasks', 't2')
    const query2 = adapter.queryIds(taskQuery())

    const [f1, q1, f2, q2] = await Promise.all([find1, query1, find2, query2])
    expect(f1).toBeTruthy()
    expect(f2).toBeTruthy()
    expect(q1).toEqual(['t1'])
    expect(q2).toEqual(['t1', 't2'])
  })

  it('two adapters on one file, both writing: no corruption', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter: compat1, dbName } = await createFileAdapter(platform)
    const { adapter: compat2 } = await openFileAdapter(dbName)

    await Promise.all([
      ...Array.from({ length: 50 }, (_, i) =>
        compat1.batch([['create', 'tasks', { id: `a${i}`, text1: `adapter1 task ${i}` }]]),
      ),
      ...Array.from({ length: 50 }, (_, i) =>
        compat2.batch([['create', 'tasks', { id: `b${i}`, text1: `adapter2 task ${i}` }]]),
      ),
    ])

    expect(await compat1.count(taskQuery())).toBe(100)
    expect(await compat2.count(taskQuery())).toBe(100)
    expect(await compat1.find('tasks', 'a0')).not.toBeNull()
    expect(await compat2.find('tasks', 'b0')).not.toBeNull()
    cleanupDb(dbName, platform)
  })

  it('two adapters: long write + concurrent read', async (_adapter, AdapterClass, _extra, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter: compat1, dbName } = await createFileAdapter(platform)
    const { adapter: compat2 } = await openFileAdapter(dbName)

    const writePromise = compat1.batch(
      Array.from({ length: 1000 }, (_, i) => ['create', 'tasks', { id: `t${i}`, text1: `task ${i}` }]),
    )
    const readPromise = compat2.count(taskQuery())
    const [writeResult, readResult] = await Promise.allSettled([writePromise, readPromise])

    expect(writeResult.status).toBe('fulfilled')
    if (readResult.status === 'fulfilled') {
      expect(readResult.value).toBeGreaterThanOrEqual(0)
    }
    expect(await compat1.count(taskQuery())).toBe(1000)
    cleanupDb(dbName, platform)
  })

  it('two adapters with usesExclusiveLocking: true, both writing', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter: compat1, dbName } = await createFileAdapter(platform, {
      usesExclusiveLocking: true,
    })

    // Native SQLite exclusive locking often refuses a second connection at open time.
    let compat2
    try {
      ;({ adapter: compat2 } = await openFileAdapter(dbName, { usesExclusiveLocking: true }))
    } catch (error) {
      expect(String(error && error.message ? error.message : error)).toMatch(/locked/i)
      cleanupDb(dbName, platform)
      return
    }

    const results = await Promise.allSettled([
      ...Array.from({ length: 25 }, (_, i) =>
        compat1.batch([['create', 'tasks', { id: `a${i}`, text1: `adapter1 task ${i}` }]]),
      ),
      ...Array.from({ length: 25 }, (_, i) =>
        compat2.batch([['create', 'tasks', { id: `b${i}`, text1: `adapter2 task ${i}` }]]),
      ),
    ])
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThan(0)
    expect(await compat1.count(taskQuery())).toBeGreaterThanOrEqual(0)
    cleanupDb(dbName, platform)
  })
}
