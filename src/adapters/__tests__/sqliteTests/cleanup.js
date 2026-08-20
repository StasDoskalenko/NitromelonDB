/* eslint-disable jest/no-standalone-expect */
import { MockTask } from '../helpers'

/**
 * Cleanup tests that require a file-backed database.
 */
export default (it) => {
  // D1: unsafeResetDatabase on a file-backed database
  it('unsafeResetDatabase on file-backed database empties and reopens cleanly', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter: fileAdapterCompat } = await (async () => {
      const { createFileAdapter } = require('./helpers')
      const { adapter } = await createFileAdapter(platform)
      return { adapter: new (require('../compat').default)(adapter) }
    })()

    // Write some data
    await fileAdapterCompat.batch([
      ['create', 'tasks', { id: 't1', text1: 'hello' }],
      ['create', 'tasks', { id: 't2', text1: 'world' }],
    ])
    expect(await fileAdapterCompat.count(
      (require('../../Query').default)({ modelClass: MockTask }, []).serialize(),
    )).toBe(2)

    // Reset
    await fileAdapterCompat.unsafeResetDatabase()
    expect(await fileAdapterCompat.count(
      (require('../../Query').default)({ modelClass: MockTask }, []).serialize(),
    )).toBe(0)

    // Reopen and verify still writable
    const reopenedAdapter = await fileAdapterCompat.testClone()
    await reopenedAdapter.batch([['create', 'tasks', { id: 't3', text1: 'after reset' }]])
    expect(await reopenedAdapter.count(
      (require('../../Query').default)({ modelClass: MockTask }, []).serialize(),
    )).toBe(1)
  })

  // D2: After reset, WAL/SHM sidecars are clean
  it('after reset, database file is clean and re-usable', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter: fileAdapterCompat } = await (async () => {
      const { createFileAdapter } = require('./helpers')
      const { adapter } = await createFileAdapter(platform)
      return { adapter: new (require('../compat').default)(adapter) }
    })()

    // Write data (this creates WAL/SHM on file-backed DB)
    await fileAdapterCompat.batch([['create', 'tasks', { id: 't1', text1: 'hello' }]])

    // Reset
    await fileAdapterCompat.unsafeResetDatabase()

    // Reopen and write again — should not fail
    const reopenedAdapter = await fileAdapterCompat.testClone()
    await reopenedAdapter.batch([['create', 'tasks', { id: 't2', text1: 'after reset' }]])
    expect(await reopenedAdapter.count(
      (require('../../Query').default)({ modelClass: MockTask }, []).serialize(),
    )).toBe(1)
  })

  // D4: unsafeResetDatabase against native SQLite (not a mock)
  it('unsafeResetDatabase against native SQLite works correctly', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter: fileAdapterCompat } = await (async () => {
      const { createFileAdapter } = require('./helpers')
      const { adapter } = await createFileAdapter(platform)
      return { adapter: new (require('../compat').default)(adapter) }
    })()

    // Write data
    await fileAdapterCompat.batch([['create', 'tasks', { id: 't1', text1: 'hello' }]])

    // Reset
    await fileAdapterCompat.unsafeResetDatabase()

    // Should be empty and writable
    expect(await fileAdapterCompat.count(
      (require('../../Query').default)({ modelClass: MockTask }, []).serialize(),
    )).toBe(0)
  })

  // D7: Repeated create-write-reset cycles (×20) don't leak handles
  it('repeated create-write-reset cycles (×20) don\'t leak handles', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter: fileAdapterCompat } = await (async () => {
      const { createFileAdapter } = require('./helpers')
      const { adapter } = await createFileAdapter(platform)
      return { adapter: new (require('../compat').default)(adapter) }
    })()

    for (let i = 0; i < 20; i++) {
      await fileAdapterCompat.batch([['create', 'tasks', { id: `t${i}`, text1: `cycle ${i}` }]])
      expect(await fileAdapterCompat.count(
        (require('../../Query').default)({ modelClass: MockTask }, []).serialize(),
      )).toBe(1)
      await fileAdapterCompat.unsafeResetDatabase()
      expect(await fileAdapterCompat.count(
        (require('../../Query').default)({ modelClass: MockTask }, []).serialize(),
      )).toBe(0)
    }
  })

  // D5: deleteDatabaseFile removes the database and its -wal/-shm sidecars
  // Note: Android and Windows have stub implementations (TODO: unimplemented)
  it('deleteDatabaseFile removes the database and sidecars', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return
    if (platform === 'android' || platform === 'windows') {
      // Skip on platforms where deleteDatabaseFile is not yet implemented
      return
    }

    const { createFileAdapter, cleanupDb, assertDbExists } = require('./helpers')
    const { adapter: fileAdapterCompat, dbName } = await createFileAdapter(platform)

    // Write some data (creates WAL/SHM on file-backed DB)
    await fileAdapterCompat.batch([['create', 'tasks', { id: 't1', text1: 'hello' }]])

    // Verify the database file exists
    assertDbExists(dbName, platform)

    // Delete the database file
    await fileAdapterCompat.unsafeResetDatabase()

    // Reopen should create a fresh database
    const reopenedAdapter = await fileAdapterCompat.testClone()
    expect(await reopenedAdapter.count(
      (require('../../Query').default)({ modelClass: MockTask }, []).serialize(),
    )).toBe(0)

    // Clean up
    cleanupDb(dbName, platform)
  })
}
