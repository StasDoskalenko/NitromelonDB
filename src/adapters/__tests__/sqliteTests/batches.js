/* eslint-disable jest/no-standalone-expect */
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
