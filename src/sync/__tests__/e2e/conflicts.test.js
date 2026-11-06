import { ADAPTERS, expectConverged, makeClient, setUpServer, SyncHttpError } from './helpers'

const server = setUpServer()

// Alice and Bob share a task, synced on both devices
async function setUp(adapterKind) {
  const alice = makeClient(server, adapterKind)
  const bob = makeClient(server, adapterKind)
  await alice.write(() =>
    alice.tasks.create((t) => {
      t.name = 'Original name'
      t.description = 'Original description'
      t.position = 1
    }),
  )
  await alice.sync()
  await bob.sync()
  const [aliceTask] = await alice.tasks.query().fetch()
  const [bobTask] = await bob.tasks.query().fetch()
  return { alice, bob, aliceTask, bobTask }
}

describe.each(ADAPTERS)('Sync conflicts end-to-end (%s)', (adapterKind) => {
  it('merges edits of different columns of the same record', async () => {
    const { alice, bob, aliceTask, bobTask } = await setUp(adapterKind)
    await alice.write(() => aliceTask.update((t) => (t.name = 'Name by Alice')))
    await bob.write(() => bobTask.update((t) => (t.description = 'Description by Bob')))

    await alice.sync()
    await bob.sync()
    await alice.sync()

    const state = await expectConverged(server, [alice, bob])
    expect(state.tasks[0]).toMatchObject({
      name: 'Name by Alice',
      description: 'Description by Bob',
    })
  })

  it('keeps the edit of whoever syncs last when both edit the same column', async () => {
    const { alice, bob, aliceTask, bobTask } = await setUp(adapterKind)
    await alice.write(() => aliceTask.update((t) => (t.name = 'Name by Alice')))
    await bob.write(() => bobTask.update((t) => (t.name = 'Name by Bob')))

    await alice.sync()
    // Bob's pull brings Alice's name, but Bob changed the same column locally, so his value wins
    // (local changes win per column) and he pushes it
    await bob.sync()
    await alice.sync()

    const state = await expectConverged(server, [alice, bob])
    expect(state.tasks[0].name).toBe('Name by Bob')
  })

  it('rejects a push when someone else pushed between its pull and push, and recovers on retry', async () => {
    const { alice, bob, aliceTask, bobTask } = await setUp(adapterKind)
    await alice.write(() => aliceTask.update((t) => (t.name = 'Name by Alice')))
    await bob.write(() => bobTask.update((t) => (t.description = 'Description by Bob')))

    // Alice syncs right after Bob pulled, so Bob's push is based on stale data
    bob.afterPull = () => alice.sync()
    const error = await bob.sync().catch((e) => e)
    expect(error).toBeInstanceOf(SyncHttpError)
    expect(error.status).toBe(409)
    expect(error.body.conflicts).toEqual([{ table: 'tasks', id: bobTask.id }])
    // Nothing of Bob's push was applied, and his change is still waiting to be pushed
    expect(await bob.hasUnsyncedChanges()).toBe(true)

    // Syncing again pulls Alice's change, merges it and pushes
    expect(await bob.syncUntilDone()).toBe(1)
    await alice.sync()
    const state = await expectConverged(server, [alice, bob])
    expect(state.tasks[0]).toMatchObject({
      name: 'Name by Alice',
      description: 'Description by Bob',
    })
  })

  it('rejects a push that conflicts with a change made on the server itself', async () => {
    const { alice, aliceTask } = await setUp(adapterKind)
    await alice.write(() => aliceTask.update((t) => (t.name = 'Name by Alice')))

    alice.afterPull = () =>
      server.write('tasks', { upsert: [{ id: aliceTask.id, description: 'Set by the server' }] })
    await expect(alice.sync()).rejects.toMatchObject({ status: 409 })

    await alice.syncUntilDone()
    const state = await expectConverged(server, [alice])
    expect(state.tasks[0]).toMatchObject({
      name: 'Name by Alice',
      description: 'Set by the server',
    })
  })

  it('deletes the record everywhere when one device edits it and the other deletes it (deletion synced first)', async () => {
    const { alice, bob, aliceTask, bobTask } = await setUp(adapterKind)
    await alice.write(() => aliceTask.markAsDeleted())
    await bob.write(() => bobTask.update((t) => (t.name = 'Edited after the deletion')))

    await alice.sync()
    await bob.sync()
    await alice.sync()

    const state = await expectConverged(server, [alice, bob])
    expect(state.tasks).toEqual([])
  })

  it('deletes the record everywhere when one device edits it and the other deletes it (edit synced first)', async () => {
    const { alice, bob, aliceTask, bobTask } = await setUp(adapterKind)
    await alice.write(() => aliceTask.update((t) => (t.name = 'Edited before the deletion')))
    await bob.write(() => bobTask.markAsDeleted())

    await alice.sync()
    // Bob's pull brings Alice's edit, which is ignored because Bob deleted the record. His deletion
    // is then pushed, and it's not a conflict: Bob has seen Alice's edit by then.
    await bob.sync()
    await alice.sync()

    const state = await expectConverged(server, [alice, bob])
    expect(state.tasks).toEqual([])
  })
})
