import { ADAPTERS, expectConverged, makeClient, serverSnapshot, setUpServer } from './helpers'

const server = setUpServer()

describe.each(ADAPTERS)('Sync end-to-end (%s)', (adapterKind) => {
  it('pushes local records and delivers them to another device on its first sync', async () => {
    const alice = makeClient(server, adapterKind)
    const bob = makeClient(server, adapterKind)

    await alice.write(async () => {
      const project = await alice.projects.create((p) => {
        p.name = 'Groceries'
        p.isFavorite = true
      })
      const task = await alice.tasks.create((t) => {
        t.project.set(project)
        t.name = 'Buy eggs'
        t.position = 1
        t.priority = 2
      })
      await alice.comments.create((c) => {
        c.task.set(task)
        c.body = 'Free range'
        c.createdAt = 1700000000000
      })
    })
    await alice.sync()

    const onServer = await serverSnapshot(server)
    expect(onServer.projects).toEqual([
      { id: expect.any(String), name: 'Groceries', is_favorite: true },
    ])
    expect(onServer.tasks).toHaveLength(1)
    expect(onServer.tasks[0]).toMatchObject({ name: 'Buy eggs', position: 1, priority: 2 })
    expect(onServer.comments[0]).toMatchObject({
      body: 'Free range',
      task_id: onServer.tasks[0].id,
    })

    await bob.sync()
    await expectConverged(server, [alice, bob])
    // Bob got everything in his first pull
    expect(bob.pulls[0].lastPulledAt).toBe(null)
    expect(bob.pulls[0].result.changes.tasks.updated).toHaveLength(1)
  })

  it('propagates updates, and a second sync with no changes is a no-op', async () => {
    const alice = makeClient(server, adapterKind)
    const bob = makeClient(server, adapterKind)
    let task
    await alice.write(async () => {
      task = await alice.tasks.create((t) => {
        t.name = 'Draft'
        t.position = 1
      })
    })
    await alice.sync()
    await bob.sync()

    await alice.write(() =>
      task.update((t) => {
        t.name = 'Final'
        t.isCompleted = true
      }),
    )
    await alice.sync()
    await bob.sync()

    const state = await expectConverged(server, [alice, bob])
    expect(state.tasks[0]).toMatchObject({ name: 'Final', is_completed: true })
    expect(bob.pulls[1].result.changes.tasks.updated).toHaveLength(1)

    // Nothing changed: the pull is empty and nothing is pushed
    const pushesBefore = bob.pushes.length
    await bob.sync()
    expect(bob.pulls[2].result.changes.tasks).toEqual({ created: [], updated: [], deleted: [] })
    expect(bob.pushes).toHaveLength(pushesBefore)
  })

  it('propagates deletions, and the server deletes descendants of deleted records', async () => {
    const alice = makeClient(server, adapterKind)
    const bob = makeClient(server, adapterKind)
    let project
    await alice.write(async () => {
      project = await alice.projects.create((p) => {
        p.name = 'Old project'
      })
      const task = await alice.tasks.create((t) => {
        t.project.set(project)
        t.name = 'Old task'
      })
      await alice.comments.create((c) => {
        c.task.set(task)
        c.body = 'Old comment'
      })
      await alice.projects.create((p) => {
        p.name = 'Keep me'
      })
    })
    await alice.sync()
    await bob.sync()

    // Alice deletes only the project. Its task and comment stay on her device as orphans, but the
    // server deletes them too, and Bob's device gets all three deletions.
    await alice.write(() => project.markAsDeleted())
    await alice.sync()
    await bob.sync()

    const dump = await server.dump()
    expect(dump.tasks[0].deleted).toBe(1)
    expect(dump.comments[0].deleted).toBe(1)
    const bobState = await bob.snapshot()
    expect(bobState.projects.map((p) => p.name)).toEqual(['Keep me'])
    expect(bobState.tasks).toEqual([])
    expect(bobState.comments).toEqual([])

    // Alice's own orphans go away on her next pull, so everyone ends up in the same place
    await alice.sync()
    await expectConverged(server, [alice, bob])
  })

  it('cascades deletes the app made itself without false conflicts', async () => {
    const alice = makeClient(server, adapterKind)
    let project
    await alice.write(async () => {
      project = await alice.projects.create((p) => {
        p.name = 'Project'
      })
      await alice.tasks.create((t) => {
        t.project.set(project)
        t.name = 'Task'
      })
    })
    await alice.sync()

    // Typical app code: delete the project and its tasks together. The server's own cascade from
    // the project must not make the explicit task deletion look like a conflict.
    await alice.write(async () => {
      const tasks = await project.tasks.fetch()
      await alice.database.batch(
        project.prepareMarkAsDeleted(),
        ...tasks.map((t) => t.prepareMarkAsDeleted()),
      )
    })
    await alice.sync()
    const state = await expectConverged(server, [alice])
    expect(state).toEqual({ projects: [], tasks: [], comments: [] })
  })

  it('picks up changes made on the server itself', async () => {
    const alice = makeClient(server, adapterKind)
    await server.write('projects', {
      upsert: [
        { id: 'serverproject01', name: 'From the admin panel', is_favorite: false },
        { id: 'serverproject02', name: 'Also from the server', is_favorite: true },
      ],
    })
    await alice.sync()
    expect((await alice.snapshot()).projects.map((p) => p.name)).toEqual([
      'From the admin panel',
      'Also from the server',
    ])

    await server.write('projects', {
      upsert: [{ id: 'serverproject01', name: 'Renamed on the server' }],
      delete: ['serverproject02'],
    })
    await alice.sync()
    const state = await expectConverged(server, [alice])
    expect(state.projects).toEqual([
      { id: 'serverproject01', name: 'Renamed on the server', is_favorite: false },
    ])
  })
})
