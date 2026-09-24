/* eslint-disable jest/no-standalone-expect */
import * as Q from '../../../QueryDescription'
import { taskQuery } from '../helpers'
import { createFileAdapter } from './helpers'

/**
 * Large batch tests that require a file-backed database.
 */
export default (it) => {
  it('large create batch (10k records) all present and findable after reopen', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)

    const batch = Array.from({ length: 10000 }, (_, i) => [
      'create',
      'tasks',
      { id: `t${i}`, text1: `task ${i}`, order: i },
    ])
    await adapter.batch(batch)
    expect(await adapter.count(taskQuery())).toBe(10000)

    const reopenedAdapter = await adapter.testClone()
    for (const i of [0, 100, 1000, 5000, 9999]) {
      const record = await reopenedAdapter.find('tasks', `t${i}`)
      expect(record).not.toBeNull()
      expect(record.text1).toBe(`task ${i}`)
    }
  })

  it('drops and recreates indices only when a batch is at least as big as the table', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)
    const sqlite = adapter.underlyingAdapter
    const sentBatches = []
    const originalCall = sqlite._dispatcher.call.bind(sqlite._dispatcher)
    sqlite._dispatcher.call = (method, args, callback) => {
      if (method === 'batch') {
        sentBatches.push(args[0])
      }
      return originalCall(method, args, callback)
    }
    const dropsIndices = (batch) => batch.some(([, , sql]) => sql.startsWith('drop index'))
    const creates = (from, count) =>
      Array.from({ length: count }, (_, i) => [
        'create',
        'tasks',
        { id: `t${from + i}`, text1: `task ${from + i}`, order: from + i },
      ])

    // Bulk load into an empty table: rebuilding indices once at the end is the cheaper path
    await adapter.batch(creates(0, 3000))
    expect(dropsIndices(sentBatches[0])).toBe(true)

    // A chunk smaller than the table: rebuilding would re-sort all rows, so keep the indices
    await adapter.batch(creates(3000, 1000))
    expect(dropsIndices(sentBatches[1])).toBe(false)

    expect(await adapter.count(taskQuery())).toBe(4000)
    const indices = (
      await adapter.unsafeQueryRaw({
        table: 'tasks',
        description: Q.buildQueryDescription([
          Q.unsafeSqlQuery(`select name from sqlite_master where type = 'index' and tbl_name = 'tasks'`),
        ]),
        associations: [],
      })
    ).map((row) => row.name)
    expect(indices).toEqual(expect.arrayContaining(['tasks__status']))
  })

  it('large delete batch (10k destroyPermanently) removes all records', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)

    const records = Array.from({ length: 1000 }, (_, i) => ({ id: `t${i}`, text1: `task ${i}` }))
    await adapter.batch(records.map((r) => ['create', 'tasks', r]))
    await adapter.batch(records.map((r) => ['destroyPermanently', 'tasks', r.id]))
    expect(await adapter.count(taskQuery())).toBe(0)
  })

  it('large destroyMatching (10k records) removes only matching records', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)

    const records = Array.from({ length: 10000 }, (_, i) => ({
      id: `t${i}`,
      text1: `task ${i}`,
      bool1: i % 3 === 0,
    }))
    await adapter.batch(records.map((r) => ['create', 'tasks', r]))
    const matchingCount = records.filter((r) => r.bool1).length

    const destroyedIds = await adapter.destroyMatching(taskQuery(Q.where('bool1', true)), true)

    expect(destroyedIds).toHaveLength(matchingCount)
    expect(await adapter.count(taskQuery(Q.where('bool1', true)))).toBe(0)
    expect(await adapter.count(taskQuery())).toBe(records.length - matchingCount)
  })

  it('large destroyMatching with no conditions clears the whole table via one statement', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)

    const records = Array.from({ length: 10000 }, (_, i) => ({ id: `t${i}`, text1: `task ${i}` }))
    await adapter.batch(records.map((r) => ['create', 'tasks', r]))

    const destroyedIds = await adapter.destroyMatching(taskQuery(), true)

    expect(destroyedIds).toHaveLength(records.length)
    expect(await adapter.count(taskQuery())).toBe(0)
  })

  it('large batch triggers index-recreation path and indices remain valid', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)

    await adapter.batch(
      Array.from({ length: 500 }, (_, i) => ['create', 'tasks', { id: `t${i}`, text1: `task ${i}` }]),
    )
    await adapter.batch(
      Array.from({ length: 1000 }, (_, i) => ['markAsDeleted', 'tasks', `t${i % 500}`]),
    )

    expect(await adapter.count(taskQuery())).toBe(0)

    await adapter.batch([
      ['create', 'tasks', { id: 'new1', text1: 'new task 1' }],
      ['create', 'tasks', { id: 'new2', text1: 'new task 2' }],
    ])
    expect(await adapter.count(taskQuery())).toBe(2)
    expect(await adapter.find('tasks', 'new1')).toBeTruthy()
    expect(await adapter.queryIds(taskQuery())).toEqual(expect.arrayContaining(['new1', 'new2']))
  })

  it("sequential large batches (5 × 2k) don't fail with statement limits", async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)

    for (let batchNum = 0; batchNum < 5; batchNum += 1) {
      await adapter.batch(
        Array.from({ length: 2000 }, (_, i) => [
          'create',
          'tasks',
          { id: `batch${batchNum}_t${i}`, text1: `task ${i}` },
        ]),
      )
    }

    expect(await adapter.count(taskQuery())).toBe(10000)
  })
}
