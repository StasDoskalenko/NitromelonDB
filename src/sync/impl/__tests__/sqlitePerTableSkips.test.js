import Database from '../../../Database'
import SQLiteAdapter from '../../../adapters/sqlite'
import { testSchema, modelClasses } from '../../../__tests__/testModels'
import { synchronize } from '../../index'
import { fetchLocalChanges } from '../index'
import { sorted } from './helpers'

const TABLES = ['mock_projects', 'mock_project_sections', 'mock_tasks', 'mock_comments']

// A full-schema changeset: every table present, empty unless given
const changeSet = (partial = {}) =>
  Object.fromEntries(
    TABLES.map((table) => [table, { created: [], updated: [], deleted: [], ...partial[table] }]),
  )

// Sync skips work per table on SQLite: it looks for local changes only in the tables the adapter
// reports (tablesWithLocalChanges), and doesn't read tables whose remote changeset is empty. These
// tests run the real Node SQLite adapter and compare against the per-table path.

let counter = 0
function makeSqliteDatabase() {
  counter += 1
  const adapter = new SQLiteAdapter({
    schema: testSchema,
    dbName: `.tmp/sync-skips-${process.pid}-${counter}.db`,
  })
  const database = new Database({ adapter, schema: testSchema, modelClasses })
  return {
    database,
    projects: database.get('mock_projects'),
    tasks: database.get('mock_tasks'),
    comments: database.get('mock_comments'),
  }
}

// The same database, but fetchLocalChanges() checks every table (as on adapters without
// tablesWithLocalChanges)
async function fetchLocalChangesTableByTable(database) {
  const original = database.adapter.underlyingAdapter.tablesWithLocalChanges
  database.adapter.underlyingAdapter.tablesWithLocalChanges = undefined
  try {
    return await fetchLocalChanges(database)
  } finally {
    database.adapter.underlyingAdapter.tablesWithLocalChanges = original
  }
}

const summarize = ({ changes, affectedRecords }) => ({
  changes,
  affectedIds: sorted(affectedRecords).map((record) => record.id),
})

describe('sync on SQLite: per-table skips', () => {
  it('finds the same local changes as checking every table', async () => {
    const { database, projects, tasks, comments } = makeSqliteDatabase()
    const empty = summarize(await fetchLocalChangesTableByTable(database))
    expect(summarize(await fetchLocalChanges(database))).toEqual(empty)

    await synchronize({
      database,
      pullChanges: async () => ({
        changes: changeSet({
          mock_tasks: { created: [{ id: 't1' }, { id: 't2' }] },
          mock_comments: { created: [{ id: 'c1' }] },
        }),
        timestamp: 1000,
      }),
    })
    await database.write(async () => {
      await projects.create((project) => {
        project.name = 'local'
      })
      const t1 = await tasks.find('t1')
      await t1.update((task) => {
        task.name = 'changed'
      })
      const c1 = await comments.find('c1')
      await c1.markAsDeleted()
    })

    const fast = summarize(await fetchLocalChanges(database))
    expect(fast).toEqual(summarize(await fetchLocalChangesTableByTable(database)))
    expect(fast.changes.mock_tasks.updated.map((raw) => raw.id)).toEqual(['t1'])
    expect(fast.changes.mock_comments.deleted).toEqual(['c1'])
    expect(fast.changes.mock_projects.created).toHaveLength(1)
    expect(fast.changes.mock_project_sections).toEqual({ created: [], updated: [], deleted: [] })
  })

  it('pushes local changes and leaves nothing behind', async () => {
    const { database, tasks } = makeSqliteDatabase()
    await database.write(() =>
      tasks.create((task) => {
        task.name = 'new'
      }),
    )
    const pushChanges = jest.fn()
    await synchronize({
      database,
      pullChanges: async () => ({ changes: changeSet({}), timestamp: 1000 }),
      pushChanges,
    })
    expect(pushChanges).toHaveBeenCalledTimes(1)
    expect(pushChanges.mock.calls[0][0].changes.mock_tasks.created).toHaveLength(1)
    expect(await database.adapter.tablesWithLocalChanges(['mock_tasks'])).toEqual([])
  })

  it('still applies replacement to tables with an empty changeset', async () => {
    const { database, tasks } = makeSqliteDatabase()
    await synchronize({
      database,
      pullChanges: async () => ({
        changes: changeSet({ mock_tasks: { created: [{ id: 'keep' }, { id: 'drop' }] } }),
        timestamp: 1000,
      }),
    })
    // Replacement: the server's changeset is the full truth for the table, even when empty
    await synchronize({
      database,
      pullChanges: async () => ({
        changes: changeSet({ mock_tasks: { updated: [{ id: 'keep' }] } }),
        timestamp: 2000,
        experimentalStrategy: 'replacement',
      }),
    })
    expect((await tasks.query().fetch()).map((task) => task.id)).toEqual(['keep'])

    await synchronize({
      database,
      pullChanges: async () => ({
        changes: changeSet({}),
        timestamp: 3000,
        experimentalStrategy: 'replacement',
      }),
    })
    expect(await tasks.query().fetchCount()).toBe(0)
  })
})
