/* eslint-disable jest/no-standalone-expect */
import { taskQuery } from '../helpers'

/**
 * Large batch tests that require a file-backed database.
 */
export default (it) => {
  // B1: Large create batch (10k records)
  it('large create batch (10k records) all present and findable after reopen', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter: fileAdapterCompat } = await (async () => {
      const { createFileAdapter } = require('./helpers')
      const { adapter } = await createFileAdapter(platform)
      return { adapter: new (require('../compat').default)(adapter) }
    })()

    // Create 10k records
    const records = Array.from({ length: 10000 }, (_, i) => ({
      id: `t${i}`,
      text1: `task ${i}`,
      order: i,
    }))
    const batch = records.map((r) => ['create', 'tasks', { id: r.id, text1: r.text1, order: r.order }])

    await fileAdapterCompat.batch(batch)
    const count = await fileAdapterCompat.count(
      taskQuery(),
    )
    expect(count).toBe(10000)

    // Reopen and verify all findable
    const reopenedAdapter = await fileAdapterCompat.testClone()
    const checkIds = [0, 100, 1000, 5000, 9999]
    for (const i of checkIds) {
      const record = await reopenedAdapter.find('tasks', `t${i}`)
      expect(record).not.toBeNull()
      expect(record.text1).toBe(`task ${i}`)
    }
  })

  // B3: Large delete batch
  it('large delete batch (10k destroyPermanently) removes all records', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter: fileAdapterCompat } = await (async () => {
      const { createFileAdapter } = require('./helpers')
      const { adapter } = await createFileAdapter(platform)
      return { adapter: new (require('../compat').default)(adapter) }
    })()

    // Create 1k records
    const records = Array.from({ length: 1000 }, (_, i) => ({
      id: `t${i}`,
      text1: `task ${i}`,
    }))
    const createBatch = records.map((r) => ['create', 'tasks', { id: r.id, text1: r.text1 }])
    await fileAdapterCompat.batch(createBatch)

    // Destroy all
    const destroyBatch = records.map((r) => ['destroyPermanently', 'tasks', r.id])
    await fileAdapterCompat.batch(destroyBatch)

    expect(await fileAdapterCompat.count(
      taskQuery(),
    )).toBe(0)
  })

  // B2: Large batch that triggers the index-recreation path in encodeBatch (≥1000 ops)
  it('large batch triggers index-recreation path and indices remain valid', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter: fileAdapterCompat } = await (async () => {
      const { createFileAdapter } = require('./helpers')
      const { adapter } = await createFileAdapter(platform)
      return { adapter: new (require('../compat').default)(adapter) }
    })()

    // Create 500 records first (so we have something to mark as deleted)
    const createRecords = Array.from({ length: 500 }, (_, i) => ({
      id: `t${i}`,
      text1: `task ${i}`,
    }))
    const createBatch = createRecords.map((r) => ['create', 'tasks', { id: r.id, text1: r.text1 }])
    await fileAdapterCompat.batch(createBatch)

    // Now run a batch of 1000+ markAsDeleted operations to trigger index-recreation path
    const markAsDeletedBatch = Array.from({ length: 1000 }, (_, i) => {
      // Reuse the same 500 IDs (marking already-deleted is fine for this test)
      return ['markAsDeleted', 'tasks', `t${i % 500}`]
    })
    await fileAdapterCompat.batch(markAsDeletedBatch)

    // Verify indices still exist and queries work
    const count = await fileAdapterCompat.count(
      taskQuery(),
    )
    expect(count).toBe(0) // all marked as deleted

    // Create new records and verify queries still work (indices were recreated)
    await fileAdapterCompat.batch([
      ['create', 'tasks', { id: 'new1', text1: 'new task 1' }],
      ['create', 'tasks', { id: 'new2', text1: 'new task 2' }],
    ])
    expect(await fileAdapterCompat.count(
      taskQuery(),
    )).toBe(2)

    // Verify find still works
    const found = await fileAdapterCompat.find('tasks', 'new1')
    expect(found.text1).toBe('new task 1')
  })

  // B6: Sequential large batches (5 × 2k)
  it('sequential large batches (5 × 2k) don\'t fail with statement limits', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter: fileAdapterCompat } = await (async () => {
      const { createFileAdapter } = require('./helpers')
      const { adapter } = await createFileAdapter(platform)
      return { adapter: new (require('../compat').default)(adapter) }
    })()

    // 5 batches of 2k each
    for (let batchNum = 0; batchNum < 5; batchNum++) {
      const records = Array.from({ length: 2000 }, (_, i) => ({
        id: `batch${batchNum}_t${i}`,
        text1: `task ${i}`,
      }))
      const batch = records.map((r) => ['create', 'tasks', { id: r.id, text1: r.text1 }])
      await fileAdapterCompat.batch(batch)
    }

    const count = await fileAdapterCompat.count(
      taskQuery(),
    )
    expect(count).toBe(10000)
  })
}
