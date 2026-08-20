/* eslint-disable jest/no-standalone-expect */
// eslint-disable-next-line no-unused-vars
import { MockTask } from '../helpers'

/**
 * Database-level tests: construct a real `Database` with test models over the native adapter.
 * This is the prerequisite for C1–C3 and D4.
 */
export default (it) => {
  // D3: LocalStorage is cleared by reset
  it('localStorage is cleared by unsafeResetDatabase', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    // LocalStorage is supported by all adapters (including LokiJS)
    const { adapter: fileAdapterCompat } = await (async () => {
      const { createFileAdapter } = require('./helpers')
      const { adapter } = await createFileAdapter(platform)
      return { adapter: new (require('../compat').default)(adapter) }
    })()

    // Set a value
    await fileAdapterCompat.setLocal('testKey', 'testValue')
    expect(await fileAdapterCompat.getLocal('testKey')).toBe('testValue')

    // Reset
    await fileAdapterCompat.unsafeResetDatabase()

    // Should be cleared
    expect(await fileAdapterCompat.getLocal('testKey')).toBeNull()
  })

  // D6: Reopening after deletion mid-session doesn't resurrect stale cached IDs
  it('reopening after deletion doesn\'t resurrect stale cached IDs', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter: fileAdapterCompat } = await (async () => {
      const { createFileAdapter } = require('./helpers')
      const { adapter } = await createFileAdapter(platform)
      return { adapter: new (require('../compat').default)(adapter) }
    })()

    // Create a record
    await fileAdapterCompat.batch([['create', 'tasks', { id: 't1', text1: 'hello' }]])
    expect(await fileAdapterCompat.find('tasks', 't1')).not.toBeNull()

    // Delete it
    await fileAdapterCompat.batch([['destroyPermanently', 'tasks', 't1']])
    expect(await fileAdapterCompat.find('tasks', 't1')).toBeNull()

    // Reopen
    const reopenedAdapter = await fileAdapterCompat.testClone()

    // Should still be null after reopen (no stale cache)
    expect(await reopenedAdapter.find('tasks', 't1')).toBeNull()
  })
}
