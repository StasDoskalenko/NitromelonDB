import Database from '../../../Database'
import SQLiteAdapter from '../../../adapters/sqlite'
import { testSchema, modelClasses } from '../../../__tests__/testModels'
import { synchronize } from '../../index'
import { fetchLocalChanges } from '../index'
import { sorted, prepareCreateFromRaw } from './helpers'
import { localChangeStatuses } from '../../../RawRecord'
import { logger } from '../../../utils/common'

const TABLES = ['mock_projects', 'mock_project_sections', 'mock_tasks', 'mock_comments']

// A full-schema changeset: every table present, empty unless given
const changeSet = (partial = {}) =>
  Object.fromEntries(
    TABLES.map((table) => [table, { created: [], updated: [], deleted: [], ...partial[table] }]),
  )

// Sync skips work per table on SQLite: it looks for local changes only in the tables the adapter
// reports (tablesWithLocalChanges), and doesn't read tables whose remote changeset is empty. These
// tests run the real Node SQLite adapter and compare against the per-table path.

// Database files go in .tmp, like the other Node SQLite tests. Create it here instead of relying on
// another test file having run first.
beforeAll(() => {
  require('fs').mkdirSync('.tmp', { recursive: true })
})

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

// Deterministic PRNG, so a failing randomized run can be replayed
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('sync on SQLite: per-table skips', () => {
  it('classifies exactly the statuses that sync reads as local changes', () => {
    // fetchLocalChanges() reads `created` and `updated` records and getDeletedRecords() reads
    // `deleted` ones; tablesWithLocalChanges() looks for localChangeStatuses. If this fails because
    // a status was added to localChangeStatuses, make sync's per-table reads pick it up too.
    expect([...localChangeStatuses].sort()).toEqual(['created', 'deleted', 'updated'])
  })

  it('reports a table for each local-change status, and not for synced records', async () => {
    const { database } = makeSqliteDatabase()
    const tables = ['mock_projects', 'mock_tasks', 'mock_comments', 'mock_project_sections']
    const statuses = [...localChangeStatuses, 'synced']
    await database.write(() =>
      database.batch(
        statuses.map((status, i) =>
          prepareCreateFromRaw(database.get(tables[i]), { id: `r${i}`, _status: status }),
        ),
      ),
    )
    const expected = tables.slice(0, localChangeStatuses.length)
    expect(sorted(await database.adapter.tablesWithLocalChanges(tables))).toEqual(sorted(expected))
    const fast = summarize(await fetchLocalChanges(database))
    expect(fast).toEqual(summarize(await fetchLocalChangesTableByTable(database)))
    expect(fast.affectedIds.length + fast.changes.mock_comments.deleted.length).toBe(
      localChangeStatuses.length,
    )
  })

  it('reads every table if the check fails', async () => {
    const { database, tasks } = makeSqliteDatabase()
    await database.write(() =>
      tasks.create((task) => {
        task.name = 'local'
      }),
    )
    const expected = summarize(await fetchLocalChangesTableByTable(database))
    const underlying = database.adapter.underlyingAdapter
    const original = underlying.tablesWithLocalChanges
    underlying.tablesWithLocalChanges = (_tables, callback) =>
      callback({ error: new Error('check failed') })
    const logged = jest.spyOn(logger, 'error').mockImplementation(() => {})
    try {
      expect(summarize(await fetchLocalChanges(database))).toEqual(expected)
      expect(expected.changes.mock_tasks.created).toHaveLength(1)
      expect(logged).toHaveBeenCalledTimes(1)
      expect(String(logged.mock.calls[0][0])).toContain('check failed')
    } finally {
      logged.mockRestore()
      underlying.tablesWithLocalChanges = original
    }
  })

  // The one way this optimization could lose data: skipping a table that has local changes, so
  // they're never pushed. Random local creates/updates/deletes/destroys, remote pulls and pushes
  // across all tables; after every step, the fast path must find exactly what reading every table
  // finds.
  it('matches reading every table through random local changes, pulls and pushes', async () => {
    const random = mulberry32(109)
    const pick = (items) => items[Math.floor(random() * items.length)]
    const { database } = makeSqliteDatabase()
    const collections = TABLES.map((table) => database.get(table))
    let timestamp = 1000
    let remoteId = 0

    for (let step = 0; step < 150; step += 1) {
      const roll = random()
      const collection = pick(collections)
      // eslint-disable-next-line no-await-in-loop
      const existing = await collection.query().fetch()
      if (roll < 0.3 || !existing.length) {
        // eslint-disable-next-line no-await-in-loop
        await database.write(() => collection.create(() => {}))
      } else if (roll < 0.5) {
        // eslint-disable-next-line no-await-in-loop
        await database.write(() => pick(existing).update(() => {}))
      } else if (roll < 0.6) {
        // eslint-disable-next-line no-await-in-loop
        await database.write(() => pick(existing).markAsDeleted())
      } else if (roll < 0.65) {
        // eslint-disable-next-line no-await-in-loop
        await database.write(() => pick(existing).destroyPermanently())
      } else if (roll < 0.8) {
        timestamp += 1
        remoteId += 1
        const pulledAt = timestamp
        const table = pick(TABLES)
        // eslint-disable-next-line no-await-in-loop
        await synchronize({
          database,
          pullChanges: async () => ({
            changes: changeSet({ [table]: { created: [{ id: `remote${remoteId}` }] } }),
            timestamp: pulledAt,
          }),
        })
      } else {
        timestamp += 1
        const pulledAt = timestamp
        // eslint-disable-next-line no-await-in-loop
        await synchronize({
          database,
          pullChanges: async () => ({ changes: changeSet(), timestamp: pulledAt }),
          pushChanges: async () => {},
        })
      }

      // eslint-disable-next-line no-await-in-loop
      const fast = summarize(await fetchLocalChanges(database))
      // eslint-disable-next-line no-await-in-loop
      expect(fast).toEqual(summarize(await fetchLocalChangesTableByTable(database)))
    }
  })

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
