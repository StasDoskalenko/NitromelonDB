import { ADAPTERS, expectConverged, makeClient, setUpServer } from './helpers'

const server = setUpServer()

describe.each(ADAPTERS)('Sync reliability end-to-end (%s)', (adapterKind) => {
  it('recovers when a push reached the server but the app never saw the response', async () => {
    const alice = makeClient(server, adapterKind)
    let task
    await alice.write(async () => {
      task = await alice.tasks.create((t) => {
        t.name = 'Created'
        t.position = 1
      })
    })
    // The push is applied on the server, then the response is lost (crash, timeout, ...), so the
    // app doesn't mark anything as synced
    alice.afterPush = () => {
      throw new TypeError('Network request failed')
    }
    await expect(alice.sync()).rejects.toThrow('Network request failed')
    expect((await server.dump()).tasks).toHaveLength(1)
    expect(await alice.hasUnsyncedChanges()).toBe(true)

    // Meanwhile the user keeps editing the same record
    await alice.write(() => task.update((t) => (t.name = 'Edited after the lost response')))

    // The next sync pushes the record again. The server already has it, and updates it instead of
    // failing or creating a duplicate (Backend.md, push 2).
    await alice.sync()
    const state = await expectConverged(server, [alice])
    expect(state.tasks).toEqual([
      expect.objectContaining({ id: task.id, name: 'Edited after the lost response' }),
    ])
  })

  it('recovers when a deletion reached the server but the app never saw the response', async () => {
    const alice = makeClient(server, adapterKind)
    let task
    await alice.write(async () => {
      task = await alice.tasks.create((t) => {
        t.name = 'To delete'
      })
    })
    await alice.sync()

    await alice.write(() => task.markAsDeleted())
    alice.afterPush = () => {
      throw new TypeError('Network request failed')
    }
    await expect(alice.sync()).rejects.toThrow('Network request failed')

    // Deleting a record the server already deleted is fine (Backend.md, push 4)
    await alice.sync()
    const state = await expectConverged(server, [alice])
    expect(state.tasks).toEqual([])
  })

  it('keeps changes made offline and syncs them once back online', async () => {
    const alice = makeClient(server, adapterKind)
    const bob = makeClient(server, adapterKind)
    let project
    await alice.write(async () => {
      project = await alice.projects.create((p) => {
        p.name = 'Trip'
      })
    })
    await alice.sync()
    await bob.sync()

    alice.offline = true
    for (let i = 1; i <= 3; i += 1) {
      await alice.write(() =>
        alice.tasks.create((t) => {
          t.project.set(project)
          t.name = `Offline task ${i}`
          t.position = i
        }),
      )
      await expect(alice.sync()).rejects.toThrow('Network request failed')
    }
    await alice.write(() => project.update((p) => (p.name = 'Trip (renamed offline)')))
    await expect(alice.sync()).rejects.toThrow('Network request failed')

    // Bob keeps working online in the meantime
    const [bobProject] = await bob.projects.query().fetch()
    await bob.write(() => bobProject.update((p) => (p.isFavorite = true)))
    await bob.sync()

    alice.offline = false
    await alice.sync()
    await bob.sync()

    const state = await expectConverged(server, [alice, bob])
    expect(state.projects).toEqual([
      expect.objectContaining({ name: 'Trip (renamed offline)', is_favorite: true }),
    ])
    expect(state.tasks.map((t) => t.name).sort()).toEqual([
      'Offline task 1',
      'Offline task 2',
      'Offline task 3',
    ])
  })

  it('keeps a local deletion when the app syncs, deletes the record and syncs again', async () => {
    // The most common flow there is. The next pull returns the app's own pushed record (its
    // lastPulledAt is from before the push), and that must not undo the deletion.
    const alice = makeClient(server, adapterKind)
    let project
    await alice.write(async () => {
      project = await alice.projects.create((p) => {
        p.name = 'Short-lived'
      })
    })
    await alice.sync()
    await alice.write(() => project.markAsDeleted())
    await alice.sync()

    const state = await expectConverged(server, [alice])
    expect(state.projects).toEqual([])
  })
})

// With `created` and `updated` split by server_created_at, as Backend.md suggests, the app's own
// pushed records come back as `created` on its next pull. A record deleted in the meantime must stay
// deleted, as with `updated`.
describe('Records echoed back as `created`', () => {
  const createdServer = setUpServer({ sendCreated: true })

  describe.each(ADAPTERS)('%s', (adapterKind) => {
    it('keeps a local deletion when the record is echoed back as created', async () => {
      const alice = makeClient(createdServer, adapterKind)
      let project
      await alice.write(async () => {
        project = await alice.projects.create((p) => {
          p.name = 'Short-lived'
        })
      })
      await alice.sync()
      await alice.write(() => project.markAsDeleted())
      await alice.sync()

      const state = await expectConverged(createdServer, [alice])
      expect(state.projects).toEqual([])
    })
  })
})
