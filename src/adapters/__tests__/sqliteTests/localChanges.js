/* eslint-disable jest/no-standalone-expect */
import { createFileAdapter } from './helpers'

const ALL_TABLES = ['tasks', 'projects', 'teams', 'organizations', 'tag_assignments', 'sync_tests']

const sorted = (tables) => [...tables].sort()

/**
 * tablesWithLocalChanges(): sync uses it to look for local changes only in tables that have some.
 * Getting it wrong means local changes that never get pushed, so every status is covered.
 */
export default (it) => {
  it('tablesWithLocalChanges finds exactly the tables with created, updated or deleted records', async (_adapter, _AdapterClass, _extra, platform) => {
    const { adapter } = await createFileAdapter(platform)
    expect(await adapter.tablesWithLocalChanges(ALL_TABLES)).toEqual([])

    await adapter.batch([
      ['create', 'tasks', { id: 't1', _status: 'synced', _changed: '' }],
      ['create', 'projects', { id: 'p1', _status: 'synced', _changed: '' }],
    ])
    expect(await adapter.tablesWithLocalChanges(ALL_TABLES)).toEqual([])

    await adapter.batch([
      ['create', 'teams', { id: 'x1', _status: 'created', _changed: '' }],
      ['update', 'tasks', { id: 't1', _status: 'updated', _changed: 'text1' }],
      ['create', 'organizations', { id: 'o1', _status: 'synced', _changed: '' }],
    ])
    await adapter.batch([['markAsDeleted', 'projects', 'p1']])
    expect(sorted(await adapter.tablesWithLocalChanges(ALL_TABLES))).toEqual([
      'projects',
      'tasks',
      'teams',
    ])

    // Only the tables asked about
    expect(await adapter.tablesWithLocalChanges(['teams', 'organizations'])).toEqual(['teams'])
    expect(await adapter.tablesWithLocalChanges([])).toEqual([])

    // Back to synced: no longer reported
    await adapter.batch([['update', 'teams', { id: 'x1', _status: 'synced', _changed: '' }]])
    await adapter.destroyDeletedRecords('projects', ['p1'])
    expect(await adapter.tablesWithLocalChanges(ALL_TABLES)).toEqual(['tasks'])
  })

  it('tablesWithLocalChanges rejects unknown tables', async (_adapter, _AdapterClass, _extra, platform) => {
    const { adapter } = await createFileAdapter(platform)
    await expect(adapter.tablesWithLocalChanges(['tasks', 'no_such_table'])).rejects.toBeTruthy()
  })
}
