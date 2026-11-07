import { ADAPTERS, expectConverged, makeClient, setUpServer } from './helpers'

const server = setUpServer()

// More than two batches: _unsafeBatchPerCollection commits at most 5000 records of a table at a time
const TASK_COUNT = 12000

const taskIds = Array.from(
  { length: TASK_COUNT },
  (_, i) => `batchtask${String(i).padStart(6, '0')}`,
)

// Counts the notifications a pull sends: one per database.batch() to database subscribers, and the
// size of each change set sent to the collection's subscribers
const watchTasks = (client) => {
  const notifications = { database: 0, collection: [] }
  client.database.experimentalSubscribe(['tasks'], () => {
    notifications.database += 1
  })
  client.tasks.experimentalSubscribe((changeSet) => {
    notifications.collection.push(changeSet.length)
  })
  return notifications
}

describe.each(ADAPTERS)('Batched pulls end-to-end (%s)', (adapterKind) => {
  it('applies a large pull in batches, with one notification per pull', async () => {
    await server.write('tasks', {
      upsert: taskIds.map((id, i) => ({ id, name: `Task ${i}`, position: i })),
    })
    const alice = makeClient(server, adapterKind)

    let notifications = watchTasks(alice)
    await alice.sync({ _unsafeBatchPerCollection: true })

    expect(notifications.database).toBe(1)
    expect(notifications.collection).toEqual([TASK_COUNT])
    expect(await alice.tasks.query().fetchCount()).toBe(TASK_COUNT)

    // The next pull updates and deletes records across the batches
    await server.write('tasks', {
      upsert: taskIds.slice(0, 7000).map((id) => ({ id, name: 'Updated on the server' })),
      delete: taskIds.slice(7000, 8000),
    })
    notifications = watchTasks(alice)
    await alice.sync({ _unsafeBatchPerCollection: true })

    expect(notifications.database).toBe(1)
    expect(notifications.collection).toEqual([8000])
    const state = await expectConverged(server, [alice])
    expect(state.tasks).toHaveLength(TASK_COUNT - 1000)
    expect(state.tasks.filter((task) => task.name === 'Updated on the server')).toHaveLength(7000)
  })
})
