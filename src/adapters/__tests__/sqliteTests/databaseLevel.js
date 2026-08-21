/* eslint-disable jest/no-standalone-expect */
import { createFileAdapter } from './helpers'

/**
 * Database-level adapter tests (LocalStorage + ID cache across reopen).
 */
export default (it) => {
  it('localStorage is cleared by unsafeResetDatabase', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    const { adapter } = await createFileAdapter(platform)

    await adapter.setLocal('testKey', 'testValue')
    expect(await adapter.getLocal('testKey')).toBe('testValue')

    await adapter.unsafeResetDatabase()
    expect(await adapter.getLocal('testKey')).toBeNull()
  })

  it("reopening after deletion doesn't resurrect stale cached IDs", async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)

    await adapter.batch([['create', 'tasks', { id: 't1', text1: 'hello' }]])
    expect(await adapter.find('tasks', 't1')).not.toBeNull()

    await adapter.batch([['destroyPermanently', 'tasks', 't1']])
    expect(await adapter.find('tasks', 't1')).toBeNull()

    const reopenedAdapter = await adapter.testClone()
    expect(await reopenedAdapter.find('tasks', 't1')).toBeNull()
  })
}
