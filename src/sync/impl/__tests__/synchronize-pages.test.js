import { expectToRejectWithMessage } from '../../../__tests__/utils'
import { logger } from '../../../utils/common'
import { makeDatabase, makeChangeSet, getRaw, expectSyncedAndMatches } from './helpers'

import { synchronize } from '../../index'
import { getLastPulledAt, getSavedPullCursor } from '../index'

const projectPage = (ids, timestamp, nextCursor) => ({
  changes: makeChangeSet({
    mock_projects: { updated: ids.map((id) => ({ id, name: `remote ${id}` })) },
  }),
  timestamp,
  ...(nextCursor === undefined ? {} : { nextCursor }),
})

// A server with pages of projects: page i is returned for cursor i (no cursor = page 0)
const pagedServer = (pages) =>
  jest.fn(async ({ cursor }) => {
    const index = cursor === undefined ? 0 : cursor
    const { ids, timestamp } = pages[index]
    return projectPage(ids, timestamp, index + 1 < pages.length ? index + 1 : null)
  })

describe('synchronize - paginated pulls', () => {
  it('pulls every page, passing back nextCursor, then pushes once', async () => {
    const { database, projects } = makeDatabase()
    const pullChanges = pagedServer([
      { ids: ['p1', 'p2'], timestamp: 1000 },
      { ids: ['p3'], timestamp: 1000 },
      { ids: ['p4'], timestamp: 1000 },
    ])
    const pushChanges = jest.fn()
    const log = {}
    await synchronize({ database, pullChanges, pushChanges, log })

    expect(pullChanges.mock.calls.map(([args]) => args)).toEqual([
      { lastPulledAt: null, schemaVersion: 1, migration: null },
      { lastPulledAt: null, schemaVersion: 1, migration: null, cursor: 1 },
      { lastPulledAt: null, schemaVersion: 1, migration: null, cursor: 2 },
    ])
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      await expectSyncedAndMatches(projects, id, { name: `remote ${id}` })
    }
    expect(await getLastPulledAt(database)).toBe(1000)
    expect(await getSavedPullCursor(database)).toBe(null)
    expect(log).toMatchObject({ pulledPages: 3, remoteChangeCount: 4, resumedPullCursor: false })
    expect(pushChanges).not.toHaveBeenCalled() // nothing local to push
  })

  it("doesn't pass a cursor for a pull without pages", async () => {
    const { database } = makeDatabase()
    const pullChanges = jest.fn(async () => projectPage(['p1'], 1000, null))
    await synchronize({ database, pullChanges })
    expect(pullChanges.mock.calls).toEqual([
      [{ lastPulledAt: null, schemaVersion: 1, migration: null }],
    ])
  })

  it.each([[null], [undefined], [false], ['']])(
    'treats nextCursor %p as the last page',
    async (nextCursor) => {
      const { database } = makeDatabase()
      const pullChanges = jest.fn(async () => ({
        ...projectPage(['p1'], 1000),
        nextCursor,
      }))
      await synchronize({ database, pullChanges })
      expect(pullChanges).toHaveBeenCalledTimes(1)
      expect(await getLastPulledAt(database)).toBe(1000)
      expect(await getSavedPullCursor(database)).toBe(null)
    },
  )

  it('warns about experimentalHasMore, and pulls only that page', async () => {
    const { database } = makeDatabase()
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
    try {
      const pullChanges = jest.fn(async () => ({
        ...projectPage(['p1'], 1000),
        experimentalHasMore: true,
      }))
      await synchronize({ database, pullChanges })
      expect(pullChanges).toHaveBeenCalledTimes(1)
      expect(await getLastPulledAt(database)).toBe(1000)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('experimentalHasMore'))
    } finally {
      warn.mockRestore()
    }
  })

  it('accepts a number, an object or an array as a cursor', async () => {
    const { database } = makeDatabase()
    const cursors = [0, { after: ['p1', 1000] }, ['p2']]
    let call = 0
    const pullChanges = jest.fn(async () => {
      call += 1
      return projectPage([`p${call}`], 1000, call <= cursors.length ? cursors[call - 1] : null)
    })
    await synchronize({ database, pullChanges })
    expect(pullChanges.mock.calls.map(([args]) => args.cursor)).toEqual([undefined, ...cursors])
  })

  it('applies each page in its own write, and moves lastPulledAt only after the last one', async () => {
    const { database, projects } = makeDatabase()
    const lastPulledAtSeenByPull = []
    const p1SeenByPull = []
    const pullChanges = jest.fn(async ({ cursor }) => {
      lastPulledAtSeenByPull.push(await getLastPulledAt(database))
      p1SeenByPull.push((await getRaw(projects, 'p1'))?.name ?? null)
      return cursor === 'second'
        ? projectPage(['p2'], 2000, null)
        : projectPage(['p1'], 1000, 'second')
    })
    const onWillApplyRemoteChanges = jest.fn(async () => {})
    const onDidPullChanges = jest.fn(async () => {})
    await synchronize({ database, pullChanges, onWillApplyRemoteChanges, onDidPullChanges })

    expect(lastPulledAtSeenByPull).toEqual([null, null])
    // The first page was already in the database when the second was pulled
    expect(p1SeenByPull).toEqual([null, 'remote p1'])
    // The last page's timestamp
    expect(await getLastPulledAt(database)).toBe(2000)
    expect(onWillApplyRemoteChanges.mock.calls).toEqual([
      [{ remoteChangeCount: 1 }],
      [{ remoteChangeCount: 1 }],
    ])
    expect(onDidPullChanges.mock.calls).toEqual([
      [{ timestamp: 1000, nextCursor: 'second' }],
      [{ timestamp: 2000, nextCursor: null }],
    ])
  })

  it('continues an interrupted paginated pull from the saved cursor', async () => {
    const { database, projects } = makeDatabase()
    const pages = [
      { ids: ['p1'], timestamp: 1000 },
      { ids: ['p2'], timestamp: 1000 },
      { ids: ['p3'], timestamp: 1000 },
    ]
    const server = pagedServer(pages)
    let failOnCursor = 2
    const pullChanges = jest.fn(async (args) => {
      if (args.cursor === failOnCursor) {
        throw new Error('Network request failed')
      }
      return server(args)
    })

    await expectToRejectWithMessage(
      synchronize({ database, pullChanges }),
      'Network request failed',
    )
    // The first two pages stay applied, and the cursor of the third is saved with them
    await expectSyncedAndMatches(projects, 'p2', {})
    expect(await getLastPulledAt(database)).toBe(null)
    expect(JSON.parse(await getSavedPullCursor(database))).toEqual({
      lastPulledAt: null,
      schemaVersion: 1,
      cursor: 2,
    })

    failOnCursor = null
    pullChanges.mockClear()
    const log = {}
    await synchronize({ database, pullChanges, log })
    expect(pullChanges.mock.calls.map(([args]) => args.cursor)).toEqual([2])
    expect(log.resumedPullCursor).toBe(true)
    await expectSyncedAndMatches(projects, 'p3', {})
    expect(await getLastPulledAt(database)).toBe(1000)
    expect(await getSavedPullCursor(database)).toBe(null)
  })

  it('starts over when the saved cursor was for another lastPulledAt or schema version', async () => {
    const { database, adapter } = makeDatabase()
    await adapter.setLocal(
      '__watermelon_pull_cursor',
      JSON.stringify({ lastPulledAt: 500, schemaVersion: 1, cursor: 2 }),
    )
    const pullChanges = pagedServer([{ ids: ['p1'], timestamp: 1000 }])
    await synchronize({ database, pullChanges })
    expect(pullChanges.mock.calls[0][0].cursor).toBe(undefined)
    // And the stale cursor is gone
    expect(await getSavedPullCursor(database)).toBe(null)
  })

  it('pushes with the timestamp of the last page', async () => {
    const { database, projects } = makeDatabase()
    await database.write(() => projects.create((p) => (p.name = 'local')))
    const pullChanges = pagedServer([
      { ids: ['p1'], timestamp: 1000 },
      { ids: ['p2'], timestamp: 1100 },
    ])
    const pushChanges = jest.fn()
    await synchronize({ database, pullChanges, pushChanges })
    expect(pushChanges).toHaveBeenCalledTimes(1)
    expect(pushChanges.mock.calls[0][0].lastPulledAt).toBe(1100)
  })

  it('fails instead of looping forever when nextCursor stays the same', async () => {
    const { database } = makeDatabase()
    const pullChanges = jest.fn(async () => projectPage(['p1'], 1000, 'same'))
    await expectToRejectWithMessage(
      synchronize({ database, pullChanges }),
      'returned the same nextCursor',
    )
    expect(pullChanges).toHaveBeenCalledTimes(2)
  })

  it('rejects a replacement strategy in a paginated pull', async () => {
    const { database } = makeDatabase()
    const pullChanges = jest.fn(async () => ({
      ...projectPage(['p1'], 1000, 'next'),
      experimentalStrategy: 'replacement',
    }))
    await expectToRejectWithMessage(
      synchronize({ database, pullChanges }),
      'replacement strategy can not be used with a paginated pull',
    )
  })

  it("rejects a nextCursor that can't be saved as JSON", async () => {
    const { database } = makeDatabase()
    const pullChanges = jest.fn(async () => projectPage(['p1'], 1000, { at: new Map([[1, 2]]) }))
    await expectToRejectWithMessage(
      synchronize({ database, pullChanges }),
      "nextCursor that can't be saved as JSON",
    )
  })

  it('aborts a paginated pull when another sync pulls pages at the same time', async () => {
    const { database } = makeDatabase()
    const pages = [
      { ids: ['p1'], timestamp: 1000 },
      { ids: ['p2'], timestamp: 1000 },
      { ids: ['p3'], timestamp: 1000 },
    ]
    const delayed = (delay) => {
      const server = pagedServer(pages)
      return (args) => new Promise((resolve) => setTimeout(() => resolve(server(args)), delay))
    }
    const sync1 = synchronize({ database, pullChanges: delayed(10) })
    const sync2 = synchronize({ database, pullChanges: delayed(25) }).catch((error) => error)
    expect(await sync1).toBe(undefined)
    expect(await sync2).toMatchObject({ message: expect.stringMatching(/concurrent sync/i) })
    expect(await getLastPulledAt(database)).toBe(1000)
  })
})
