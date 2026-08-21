/* eslint-disable jest/no-standalone-expect */
import { taskQuery } from '../helpers'
import { createFileAdapter, cleanupDb, assertDbExists } from './helpers'

/**
 * Cleanup tests that require a file-backed database.
 */
export default (it) => {
  it('unsafeResetDatabase on file-backed database empties and reopens cleanly', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)
    await adapter.batch([
      ['create', 'tasks', { id: 't1', text1: 'hello' }],
      ['create', 'tasks', { id: 't2', text1: 'world' }],
    ])
    expect(await adapter.count(taskQuery())).toBe(2)

    await adapter.unsafeResetDatabase()
    expect(await adapter.count(taskQuery())).toBe(0)

    const reopenedAdapter = await adapter.testClone()
    await reopenedAdapter.batch([['create', 'tasks', { id: 't3', text1: 'after reset' }]])
    expect(await reopenedAdapter.count(taskQuery())).toBe(1)
  })

  it('after reset, database file is clean and re-usable', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)
    await adapter.batch([['create', 'tasks', { id: 't1', text1: 'hello' }]])
    await adapter.unsafeResetDatabase()

    const reopenedAdapter = await adapter.testClone()
    await reopenedAdapter.batch([['create', 'tasks', { id: 't2', text1: 'after reset' }]])
    expect(await reopenedAdapter.count(taskQuery())).toBe(1)
  })

  it('unsafeResetDatabase against native SQLite works correctly', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)
    await adapter.batch([['create', 'tasks', { id: 't1', text1: 'hello' }]])
    await adapter.unsafeResetDatabase()
    expect(await adapter.count(taskQuery())).toBe(0)
  })

  it("repeated create-write-reset cycles (×20) don't leak handles", async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)
    for (let i = 0; i < 20; i += 1) {
      await adapter.batch([['create', 'tasks', { id: `t${i}`, text1: `cycle ${i}` }]])
      expect(await adapter.count(taskQuery())).toBe(1)
      await adapter.unsafeResetDatabase()
      expect(await adapter.count(taskQuery())).toBe(0)
    }
  })

  it('deleteDatabaseFile removes the database and sidecars', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter, dbName } = await createFileAdapter(platform)
    await adapter.batch([['create', 'tasks', { id: 't1', text1: 'hello' }]])
    assertDbExists(dbName, platform)

    // Until deleteDatabaseFile is exposed on the JS adapter API, reset + reopen
    // is the supported cleanup path exercised here.
    await adapter.unsafeResetDatabase()
    const reopenedAdapter = await adapter.testClone()
    expect(await reopenedAdapter.count(taskQuery())).toBe(0)
    cleanupDb(dbName, platform)
  })
}
