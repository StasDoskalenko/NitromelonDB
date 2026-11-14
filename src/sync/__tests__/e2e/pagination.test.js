// Paginated pulls: the server sends at most PAGE_SIZE records per response, with a cursor for the
// next page (by (last_modified, id), like servers that page by (updated_at, id)), and
// synchronize() pulls page after page
import {
  ADAPTERS,
  expectConverged,
  makeClient,
  schemaV1,
  serverSnapshot,
  setUpServer,
  SyncHttpError,
} from './helpers'

const PAGE_SIZE = 3

const server = setUpServer({ pageSize: PAGE_SIZE })

const ids = (prefix, count) =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(4, '0')}`)

// Runs `fn` after the `page`-th pull response of this client (counting from 1), before it's applied
function afterPage(client, page, fn) {
  let count = 0
  const hook = async () => {
    count += 1
    if (count === page) {
      await fn()
    } else {
      client.afterPull = hook
    }
  }
  client.afterPull = hook
}

// 7 projects and 12 tasks, each table written at once, so many records share a last_modified and
// pages split groups of records with the same one
async function seedServer() {
  await server.write('projects', {
    upsert: ids('project', 7).map((id, i) => ({ id, name: `Project ${i}` })),
  })
  await server.write('tasks', {
    upsert: ids('task', 12).map((id, i) => ({
      id,
      project_id: 'project0000',
      name: `Task ${i}`,
      position: i,
    })),
  })
}

const pulledIds = (pull) =>
  Object.values(pull.result.changes).flatMap((table) => [
    ...table.created.map((raw) => raw.id),
    ...table.updated.map((raw) => raw.id),
    ...table.deleted,
  ])

describe.each(ADAPTERS)('Paginated pulls end-to-end (%s)', (adapterKind) => {
  it('pulls a first sync page by page, each record once', async () => {
    await seedServer()
    const alice = makeClient(server, adapterKind)
    const log = {}
    await alice.sync({ log })

    // 19 records in pages of 3
    expect(alice.pulls).toHaveLength(7)
    expect(log.pulledPages).toBe(7)
    alice.pulls.forEach((pull, i) => {
      expect(pull.cursor).toBe(i === 0 ? undefined : alice.pulls[i - 1].result.nextCursor)
      expect(pull.lastPulledAt).toBe(null)
      expect(pulledIds(pull).length).toBeLessThanOrEqual(PAGE_SIZE)
    })
    expect(alice.pulls[6].result.nextCursor).toBe(null)
    const all = alice.pulls.flatMap(pulledIds)
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(19)

    // Every page has the timestamp of the first one: the server's state when the pull started
    const timestamps = new Set(alice.pulls.map((pull) => pull.result.timestamp))
    expect(timestamps.size).toBe(1)

    await expectConverged(server, [alice])
  })

  it('pulls incremental changes and deletions in pages', async () => {
    await seedServer()
    const alice = makeClient(server, adapterKind)
    await alice.sync()

    await server.write('tasks', {
      upsert: ids('task', 5).map((id) => ({ id, name: 'Renamed on the server' })),
      delete: ids('task', 12).slice(8),
    })
    await server.write('comments', {
      upsert: [{ id: 'comment0001', task_id: 'task0000', body: 'New' }],
    })
    alice.pulls = []
    await alice.sync()
    // 5 updated + 4 deleted tasks, 1 comment
    expect(alice.pulls.map((pull) => pulledIds(pull).length)).toEqual([3, 3, 3, 1])
    const state = await expectConverged(server, [alice])
    expect(state.tasks).toHaveLength(8)
  })

  it('loses nothing when the server changes records between pages', async () => {
    await seedServer()
    const alice = makeClient(server, adapterKind)

    // After the first page: change a record that was in it, change, delete and add records that
    // weren't sent yet
    afterPage(alice, 1, async () => {
      const firstPage = pulledIds(alice.pulls[0])
      await server.write('projects', {
        upsert: [
          { id: firstPage[0], name: 'Changed after it was sent' },
          { id: 'project0006', name: 'Changed before it was sent' },
          { id: 'projectNew01', name: 'Created during the pull' },
        ],
        delete: ['project0005'],
      })
    })
    await alice.sync()

    // This pull is what the server had when it started; the changes come with the next one
    const firstSyncPulls = alice.pulls.length
    expect(alice.pulls.flatMap(pulledIds)).not.toContain('projectNew01')
    await alice.sync()
    const nextPull = alice.pulls.slice(firstSyncPulls)
    expect(nextPull.flatMap(pulledIds).sort()).toEqual(
      [pulledIds(alice.pulls[0])[0], 'project0005', 'project0006', 'projectNew01'].sort(),
    )

    const state = await expectConverged(server, [alice])
    expect(state.projects.map((p) => p.id)).not.toContain('project0005')
    expect(state.projects.find((p) => p.id === 'project0006').name).toBe(
      'Changed before it was sent',
    )
  })

  it('continues an interrupted pull from the saved cursor', async () => {
    await seedServer()
    const alice = makeClient(server, adapterKind)

    // The network goes away after the third page arrived
    afterPage(alice, 3, () => {
      alice.offline = true
    })
    await expect(alice.sync()).rejects.toThrow('Network request failed')
    // Three pages are applied (7 projects, 2 tasks), but lastPulledAt didn't move
    expect(await alice.projects.query().fetchCount()).toBe(7)
    expect(await alice.tasks.query().fetchCount()).toBe(2)
    expect(await alice.database.adapter.getLocal('__watermelon_last_pulled_at')).toBe(null)

    // Meanwhile, on the server
    await server.write('projects', { upsert: [{ id: 'project0000', name: 'Renamed meanwhile' }] })

    alice.offline = false
    const before = alice.pulls.length
    const log = {}
    await alice.sync({ log })
    expect(log.resumedPullCursor).toBe(true)
    expect(alice.pulls[before].cursor).toBe(alice.pulls[before - 1].result.nextCursor)
    // The remaining 4 pages, not all 7 again
    expect(alice.pulls.length - before).toBe(4)

    // The rename happened after the pull started, so the next sync brings it
    expect((await alice.projects.find('project0000')).name).toBe('Project 0')
    await alice.sync()
    const state = await expectConverged(server, [alice])
    expect(state.projects.find((p) => p.id === 'project0000').name).toBe('Renamed meanwhile')
  })

  it('starts over after an app update interrupted a pull', async () => {
    await seedServer()
    const oldApp = makeClient(server, adapterKind, { schema: schemaV1 })
    await oldApp.sync()
    await server.write('tasks', {
      upsert: ids('task', 12).map((id, i) => ({ id, priority: i % 3 })),
    })
    await server.write('tasks', {
      upsert: ids('task', 6).map((id) => ({ id, name: 'Renamed on the server' })),
    })
    afterPage(oldApp, 1, () => {
      oldApp.offline = true
    })
    await expect(oldApp.sync()).rejects.toThrow('Network request failed')
    expect(await oldApp.database.adapter.getLocal('__watermelon_pull_cursor')).not.toBe(null)

    // The app updates to schema version 2 before the next sync. The saved cursor was for version 1,
    // so the pull starts over, as a migration sync, in pages too.
    const newApp = await oldApp.reopen()
    const log = {}
    await newApp.sync({ log })
    expect(log.resumedPullCursor).toBe(false)
    expect(newApp.pulls[0].cursor).toBe(undefined)
    expect(newApp.pulls[0].migration).toMatchObject({ from: 1 })
    expect(newApp.pulls.length).toBeGreaterThan(1)
    expect(await newApp.database.adapter.getLocal('__watermelon_pull_cursor')).toBe(null)

    const state = await expectConverged(server, [newApp])
    expect(state.tasks.map((t) => t.priority)).toEqual(ids('task', 12).map((_, i) => i % 3))
  })

  it('keeps local edits made between pages, and pushes them after the last page', async () => {
    await seedServer()
    const alice = makeClient(server, adapterKind)
    await alice.sync()
    await server.write('tasks', {
      upsert: ids('task', 12).map((id) => ({ id, description: 'Set on the server' })),
    })

    alice.pulls = []
    afterPage(alice, 1, async () => {
      // One task that was in the first page, one that comes later
      const [early] = alice.pulls[0].result.changes.tasks.updated
      const taskNow = await alice.tasks.find(early.id)
      const late = await alice.tasks.find('task0011')
      await alice.write(async () => {
        await taskNow.update((t) => (t.description = 'Edited between pages'))
        await late.update((t) => (t.description = 'Edited before its page'))
      })
    })
    await alice.sync()
    expect(alice.pulls.length).toBeGreaterThan(1)
    expect(alice.pushes).toHaveLength(1)
    // The push is based on the pull's timestamp
    expect(alice.pushes[0].lastPulledAt).toBe(alice.pulls[0].result.timestamp)

    const state = await expectConverged(server, [alice])
    expect(state.tasks.find((t) => t.id === 'task0011').description).toBe('Edited before its page')
    expect(state.tasks.filter((t) => t.description === 'Set on the server')).toHaveLength(10)
  })

  it('rejects the push of a record the server changed during the pull, and recovers on retry', async () => {
    await seedServer()
    const alice = makeClient(server, adapterKind)
    await alice.sync()
    const task = await alice.tasks.find('task0003')
    await alice.write(() => task.update((t) => (t.description = 'Edited on Alice')))
    await server.write('tasks', {
      upsert: ids('task', 12).map((id) => ({ id, position: 100 })),
    })

    // The server renames the same task after the first page: it's newer than the pull's timestamp,
    // so the push must be rejected rather than overwrite it
    afterPage(alice, 1, () =>
      server.write('tasks', { upsert: [{ id: 'task0003', name: 'Renamed during the pull' }] }),
    )
    const error = await alice.sync().catch((e) => e)
    expect(error).toBeInstanceOf(SyncHttpError)
    expect(error.status).toBe(409)

    await alice.syncUntilDone()
    const state = await expectConverged(server, [alice])
    expect(state.tasks.find((t) => t.id === 'task0003')).toMatchObject({
      name: 'Renamed during the pull',
      description: 'Edited on Alice',
      position: 100,
    })
  })

  it('works with batched pulls', async () => {
    await seedServer()
    const alice = makeClient(server, adapterKind)
    await alice.sync({ _unsafeBatchPerCollection: true })
    expect(alice.pulls.length).toBeGreaterThan(1)
    await expectConverged(server, [alice])
  })

  it("sends everything at once to an app that doesn't ask for pages", async () => {
    await seedServer()
    // An app that doesn't pass paginatedPulls (or an older version of it) doesn't send
    // paginated=true. If the server paged anyway, it would store the first page's timestamp and
    // never get the rest.
    const oldApp = makeClient(server, adapterKind)
    oldApp.paginated = false
    await oldApp.sync()
    expect(oldApp.pulls).toHaveLength(1)
    expect(oldApp.pulls[0].result).not.toHaveProperty('nextCursor')
    expect(pulledIds(oldApp.pulls[0])).toHaveLength(19)
    await expectConverged(server, [oldApp])
  })

  it('refuses a cursor from a pull with another last_pulled_at', async () => {
    await seedServer()
    const alice = makeClient(server, adapterKind)
    await alice.sync()
    const { nextCursor } = alice.pulls[0].result
    const query = new URLSearchParams({
      last_pulled_at: String(alice.pulls[0].result.timestamp),
      schema_version: '2',
      cursor: nextCursor,
    })
    await expect(server.request('GET', `/sync/pull?${query}`)).rejects.toMatchObject({
      status: 400,
    })
    expect(await serverSnapshot(server)).toEqual(await alice.snapshot())
  })
})
