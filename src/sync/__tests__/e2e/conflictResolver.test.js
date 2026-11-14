import {
  ADAPTERS,
  expectConverged,
  makeClient,
  serverSnapshot,
  setUpServer,
  SyncHttpError,
} from './helpers'

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

// Wraps a conflictResolver to record what it was called with
function recording(resolver) {
  const calls = []
  const wrapped = (table, local, remote, resolved) => {
    const result = resolver(table, local, remote, resolved)
    calls.push({ table, local: { ...local }, remote: { ...remote }, result: { ...result } })
    return result
  }
  wrapped.calls = calls
  return wrapped
}

// A resolver that sets a column to something other than the server's value has to record it as a
// local change, so the next push sends it. Otherwise the device keeps its value and the server
// keeps another one, and nothing ever reconciles them.
const markChanged = (raw, column) => {
  const changed = raw._changed ? raw._changed.split(',') : []
  return {
    ...raw,
    _status: raw._status === 'synced' ? 'updated' : raw._status,
    _changed: changed.includes(column) ? raw._changed : [...changed, column].join(','),
  }
}

// Once a task is completed on a device, it stays completed, even if someone reopens it elsewhere
const keepCompleted = (table, local, remote, resolved) =>
  table === 'tasks' && local.is_completed && !remote.is_completed
    ? markChanged({ ...resolved, is_completed: true }, 'is_completed')
    : resolved

// When both sides edited the description, keep both texts instead of only the local one. Only right
// when the server really changed the description: `remote` is the whole server record (see the
// give-up test below), so this would also merge with an unchanged server value.
const mergeDescriptions = (table, local, remote, resolved) => {
  const editedLocally = local._changed.split(',').includes('description')
  if (table !== 'tasks' || !editedLocally || remote.description === local.description) {
    return resolved
  }
  return { ...resolved, description: `${remote.description}\n${local.description}` }
}

describe.each(ADAPTERS)('Custom conflictResolver end-to-end (%s)', (adapterKind) => {
  it('is called for every pulled update of a record the device has, changed locally or not', async () => {
    const { alice, bob, aliceTask } = await setUp(adapterKind)
    await alice.write(() => aliceTask.update((t) => (t.name = 'Name by Alice')))
    await alice.sync()

    const resolver = recording((table, local, remote, resolved) => resolved)
    await bob.sync({ conflictResolver: resolver })

    expect(resolver.calls).toEqual([
      {
        table: 'tasks',
        local: expect.objectContaining({ name: 'Original name', _status: 'synced', _changed: '' }),
        remote: expect.objectContaining({ name: 'Name by Alice' }),
        result: expect.objectContaining({ name: 'Name by Alice', _status: 'synced' }),
      },
    ])
    await expectConverged(server, [alice, bob])
  })

  it('keeps a value the resolver chose over the server one, once the resolver marks it as changed', async () => {
    const { alice, bob, aliceTask, bobTask } = await setUp(adapterKind)
    await bob.write(() => bobTask.update((t) => (t.isCompleted = true)))
    await bob.sync()
    await alice.sync()

    // Alice reopens the task. Bob's device hasn't changed it since its last sync.
    const aliceTaskNow = await alice.tasks.find(aliceTask.id)
    await alice.write(() => aliceTaskNow.update((t) => (t.isCompleted = false)))
    await alice.sync()

    const resolver = recording(keepCompleted)
    await bob.sync({ conflictResolver: resolver })
    expect(resolver.calls[0].local._status).toBe('synced')
    expect(resolver.calls[0].result).toMatchObject({
      is_completed: true,
      _status: 'updated',
      _changed: 'is_completed',
    })
    // The resolved value was pushed in the same sync
    expect(await bob.hasUnsyncedChanges()).toBe(false)

    await alice.sync()
    const state = await expectConverged(server, [alice, bob])
    expect(state.tasks[0].is_completed).toBe(true)
  })

  it('leaves the device out of sync with the server when the resolver changes a value without marking it', async () => {
    const { alice, bob, aliceTask, bobTask } = await setUp(adapterKind)
    await bob.write(() => bobTask.update((t) => (t.isCompleted = true)))
    await bob.sync()
    await alice.sync()
    const aliceTaskNow = await alice.tasks.find(aliceTask.id)
    await alice.write(() => aliceTaskNow.update((t) => (t.isCompleted = false)))
    await alice.sync()

    // The same rule as keepCompleted, but without markChanged
    const naive = (table, local, remote, resolved) =>
      local.is_completed && !remote.is_completed ? { ...resolved, is_completed: true } : resolved
    await bob.sync({ conflictResolver: naive })

    // Bob's record says synced, so nothing is pushed, and his device disagrees with the server
    // until someone changes that column again
    expect(await bob.hasUnsyncedChanges()).toBe(false)
    expect((await bob.tasks.find(bobTask.id)).isCompleted).toBe(true)
    expect((await serverSnapshot(server)).tasks[0].is_completed).toBe(false)
    await bob.sync({ conflictResolver: naive })
    expect((await bob.tasks.find(bobTask.id)).isCompleted).toBe(true)
  })

  it('resolves a rejected push on the retry pull, then pushes the resolved record', async () => {
    const { alice, bob, aliceTask, bobTask } = await setUp(adapterKind)
    await alice.write(() => aliceTask.update((t) => (t.description = 'Written by Alice')))
    await bob.write(() => bobTask.update((t) => (t.description = 'Written by Bob')))

    // Alice pushes right after Bob pulled, so Bob's push is rejected. The app retries.
    bob.afterPull = () => alice.sync()
    const resolver = recording(mergeDescriptions)
    expect(await bob.syncUntilDone({ conflictResolver: resolver })).toBe(2)

    // The first pull had nothing new for this task, so the resolver only ran on the retry
    expect(resolver.calls).toHaveLength(1)
    expect(resolver.calls[0]).toMatchObject({
      local: { description: 'Written by Bob', _status: 'updated', _changed: 'description' },
      remote: { description: 'Written by Alice' },
      result: { description: 'Written by Alice\nWritten by Bob', _status: 'updated' },
    })
    expect(bob.pushes).toHaveLength(2)
    expect(bob.pushes[1].changes.tasks.updated[0].description).toBe(
      'Written by Alice\nWritten by Bob',
    )

    await alice.sync()
    const state = await expectConverged(server, [alice, bob])
    expect(state.tasks[0].description).toBe('Written by Alice\nWritten by Bob')
  })

  it('keeps local changes when the app gives up retrying, and pushes them on a later sync', async () => {
    const { alice, bob, bobTask } = await setUp(adapterKind)
    await bob.write(() =>
      bobTask.update((t) => {
        t.description = 'Written by Bob'
        t.isCompleted = true
      }),
    )

    // The server reopens and renames the task between every pull and push of Bob's
    let serverEdits = 0
    const editOnServer = async () => {
      serverEdits += 1
      await server.write('tasks', {
        upsert: [
          { id: bobTask.id, name: `Renamed on the server ${serverEdits}`, is_completed: false },
        ],
      })
      bob.afterPull = editOnServer
    }
    bob.afterPull = editOnServer
    const resolver = recording(keepCompleted)
    const error = await bob
      .syncUntilDone({ maxAttempts: 3, conflictResolver: resolver })
      .catch((e) => e)
    expect(error).toBeInstanceOf(SyncHttpError)
    expect(error.status).toBe(409)
    expect(bob.pushes).toHaveLength(3)

    // The resolver ran on every retry pull. `remote` is the server's whole record, including the
    // description the server never changed, so a resolver can't tell which columns the server
    // changed: one that merges values (say, joins two texts) would merge again on every retry.
    expect(resolver.calls).toHaveLength(2)
    expect(resolver.calls.map((call) => call.remote)).toEqual([
      expect.objectContaining({
        name: 'Renamed on the server 1',
        description: 'Original description',
        is_completed: false,
      }),
      expect.objectContaining({
        name: 'Renamed on the server 2',
        description: 'Original description',
        is_completed: false,
      }),
    ])
    resolver.calls.forEach((call) =>
      expect(call.result).toMatchObject({ description: 'Written by Bob', is_completed: true }),
    )
    expect(await bob.hasUnsyncedChanges()).toBe(true)

    // Later, without interference
    bob.afterPull = null
    expect(await bob.syncUntilDone({ conflictResolver: resolver })).toBe(1)
    await alice.sync()
    const state = await expectConverged(server, [alice, bob])
    expect(state.tasks[0]).toMatchObject({
      name: 'Renamed on the server 3',
      description: 'Written by Bob',
      is_completed: true,
    })
  })

  it("isn't asked about deletions: a deletion wins on either side", async () => {
    const { alice, bob, aliceTask, bobTask } = await setUp(adapterKind)
    // Second task, so each direction gets one
    let secondOnAlice
    await alice.write(async () => {
      secondOnAlice = await alice.tasks.create((t) => {
        t.name = 'Second'
      })
    })
    await alice.sync()
    await bob.sync()
    const secondOnBob = await bob.tasks.find(secondOnAlice.id)

    // First task: deleted by Alice, edited by Bob. Second: edited by Alice, deleted by Bob.
    await alice.write(() => aliceTask.markAsDeleted())
    await alice.write(() => secondOnAlice.update((t) => (t.name = 'Edited by Alice')))
    await bob.write(() => bobTask.update((t) => (t.name = 'Edited by Bob')))
    await bob.write(() => secondOnBob.markAsDeleted())
    await alice.sync()

    const resolver = recording((table, local, remote, resolved) => resolved)
    await bob.syncUntilDone({ conflictResolver: resolver })
    await alice.sync()

    expect(resolver.calls).toEqual([])
    const state = await expectConverged(server, [alice, bob])
    expect(state.tasks).toEqual([])
  })
})
