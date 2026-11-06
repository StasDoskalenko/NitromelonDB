// Several devices make random overlapping changes and sync in random order: creates, edits of the
// same records, deletions of records others are editing, changes made on the server itself, lost
// push responses and devices going offline. Once everyone has synced:
// - every device has exactly what the server has (they converged), and
// - that's the right result: nothing anyone deleted came back, and nothing anyone created got lost
//   (unless a parent of it was deleted). Converging alone isn't enough: devices can agree on
//   something wrong, e.g. all bring a deleted record back.
// Runs are seeded, so a failing seed can be replayed:
//   SYNC_E2E_SEEDS=1234 yarn test:sync-e2e convergence
import { expectConverged, makeClient, serverSnapshot, setUpServer } from './helpers'

const SEEDS = process.env.SYNC_E2E_SEEDS
  ? process.env.SYNC_E2E_SEEDS.split(',').map(Number)
  : [1, 2, 3, 4, 5]
const STEPS = Number(process.env.SYNC_E2E_STEPS || 150)

const server = setUpServer()

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

function makeRandom(seed) {
  const next = mulberry32(seed)
  const int = (max) => Math.floor(next() * max)
  return {
    next,
    int,
    pick: (items) => (items.length ? items[int(items.length)] : null),
    chance: (p) => next() < p,
    // Picks one of [weight, value] pairs
    weighted: (options) => {
      const total = options.reduce((sum, [weight]) => sum + weight, 0)
      let roll = next() * total
      for (const [weight, value] of options) {
        roll -= weight
        if (roll < 0) {
          return value
        }
      }
      return options[options.length - 1][1]
    },
  }
}

// What every device and the server meant to do, to check the end result against.
// Keys are `table:id`; `created` maps each record to its parent's key (or null).
function makeHistory() {
  return { created: new Map(), deleted: new Set(), serverIds: 0 }
}
const key = (table, id) => `${table}:${id}`

async function randomLocalChange(client, random, step, history) {
  const projects = await client.projects.query().fetch()
  const tasks = await client.tasks.query().fetch()
  const comments = await client.comments.query().fetch()
  const action = random.weighted([
    [3, 'createProject'],
    [6, 'createTask'],
    [3, 'createComment'],
    [8, 'updateTask'],
    [2, 'updateProject'],
    [2, 'deleteTask'],
    [1, 'deleteProject'],
    [1, 'deleteComment'],
  ])

  const project = random.pick(projects)
  const task = random.pick(tasks)
  const comment = random.pick(comments)
  const actions = {
    createProject: async () => {
      const created = await client.projects.create((p) => {
        p.name = `Project ${step}`
        p.isFavorite = random.chance(0.3)
      })
      history.created.set(key('projects', created.id), null)
    },
    createTask: async () => {
      const created = await client.tasks.create((t) => {
        if (project) {
          t.project.set(project)
        }
        t.name = `Task ${step}`
        t.position = random.int(100)
        t.priority = random.int(4)
      })
      history.created.set(key('tasks', created.id), project ? key('projects', project.id) : null)
    },
    createComment: async () => {
      if (!task) {
        return
      }
      const created = await client.comments.create((c) => {
        c.task.set(task)
        c.body = `Comment ${step}`
        c.createdAt = step
      })
      history.created.set(key('comments', created.id), key('tasks', task.id))
    },
    updateTask: () =>
      task &&
      task.update((t) => {
        // Often the same columns on different devices, to get real conflicts
        if (random.chance(0.6)) t.name = `Task renamed at ${step}`
        if (random.chance(0.4)) t.isCompleted = random.chance(0.5)
        if (random.chance(0.3)) t.description = random.chance(0.2) ? null : `Notes ${step}`
        if (random.chance(0.3)) t.position = random.int(100)
      }),
    updateProject: () =>
      project &&
      project.update((p) => {
        p.name = `Project renamed at ${step}`
      }),
    deleteTask: async () => {
      if (task) {
        await task.markAsDeleted()
        history.deleted.add(key('tasks', task.id))
      }
    },
    deleteProject: async () => {
      if (!project) {
        return
      }
      // Sometimes the app deletes children too, sometimes it leaves that to the server
      const children = random.chance(0.5) ? await project.tasks.fetch() : []
      await client.database.batch(
        project.prepareMarkAsDeleted(),
        ...children.map((child) => child.prepareMarkAsDeleted()),
      )
      history.deleted.add(key('projects', project.id))
      children.forEach((child) => history.deleted.add(key('tasks', child.id)))
    },
    deleteComment: async () => {
      if (comment) {
        await comment.markAsDeleted()
        history.deleted.add(key('comments', comment.id))
      }
    },
  }
  await client.write(async () => {
    await actions[action]()
  })
}

async function randomServerChange(random, step, history) {
  const { tasks, projects } = await serverSnapshot(server)
  const task = random.pick(tasks)
  if (task && random.chance(0.7)) {
    await server.write('tasks', {
      upsert: [{ id: task.id, name: `Renamed on the server at ${step}` }],
    })
  } else if (random.chance(0.5)) {
    const project = random.pick(projects)
    if (project) {
      await server.write('projects', { delete: [project.id] })
      history.deleted.add(key('projects', project.id))
    }
  } else {
    history.serverIds += 1
    const id = `serverproject${history.serverIds}`
    await server.write('projects', { upsert: [{ id, name: `Server project ${step}` }] })
    history.created.set(key('projects', id), null)
  }
}

// The end result matches what everyone meant to do
function expectIntentKept(state, history) {
  const present = new Set()
  Object.entries(state).forEach(([table, records]) => {
    records.forEach((record) => present.add(key(table, record.id)))
  })

  const resurrected = [...history.deleted].filter((deletedKey) => present.has(deletedKey))
  expect(resurrected).toEqual([])

  const hasDeletedAncestor = (recordKey) => {
    for (
      let parent = history.created.get(recordKey);
      parent;
      parent = history.created.get(parent)
    ) {
      if (history.deleted.has(parent)) {
        return true
      }
    }
    return false
  }
  const lost = [...history.created.keys()].filter(
    (createdKey) =>
      !present.has(createdKey) &&
      !history.deleted.has(createdKey) &&
      !hasDeletedAncestor(createdKey),
  )
  expect(lost).toEqual([])
}

// Syncs, retrying after a 409. A device that's offline, or whose push response gets lost, just
// fails this sync and tries again later, like a real app would.
async function randomSync(client, random, history) {
  if (random.chance(0.1)) {
    client.afterPush = () => {
      throw new TypeError('Network request failed')
    }
  }
  if (random.chance(0.05)) {
    // Someone else pushes between this device's pull and push
    client.afterPull = () => randomServerChange(random, -1, history)
  }
  try {
    await client.syncUntilDone({ maxAttempts: 10 })
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error
    }
  } finally {
    client.afterPush = null
    client.afterPull = null
  }
}

describe('Sync convergence end-to-end', () => {
  it.each(SEEDS)(
    `converges after ${STEPS} random steps on three devices (seed %i)`,
    async (seed) => {
      const random = makeRandom(seed)
      // Mixed adapters: the same server, two SQLite devices and one LokiJS device
      const devices = [
        makeClient(server, 'sqlite'),
        makeClient(server, 'loki'),
        makeClient(server, 'sqlite'),
      ]
      const stats = { local: 0, server: 0, syncs: 0, offline: 0 }
      const history = makeHistory()

      for (let step = 0; step < STEPS; step += 1) {
        const device = random.pick(devices)
        const what = random.weighted([
          [10, 'local'],
          [5, 'sync'],
          [1, 'server'],
          [1, 'toggleOffline'],
        ])
        if (what === 'local') {
          await randomLocalChange(device, random, step, history)
          stats.local += 1
        } else if (what === 'sync') {
          await randomSync(device, random, history)
          stats.syncs += 1
        } else if (what === 'server') {
          await randomServerChange(random, step, history)
          stats.server += 1
        } else {
          device.offline = !device.offline
          stats.offline += 1
        }
      }

      // Everyone comes back online and syncs twice, so each device sees what the others pushed
      devices.forEach((device) => {
        device.offline = false
      })
      for (let round = 0; round < 2; round += 1) {
        for (const device of devices) {
          await device.syncUntilDone({ maxAttempts: 10 })
        }
      }

      const state = await expectConverged(server, devices)
      expectIntentKept(state, history)
      // Make sure the run did something worth checking
      expect(stats.local).toBeGreaterThan(STEPS / 3)
      expect(history.deleted.size).toBeGreaterThan(0)
      expect(state.tasks.length + state.projects.length).toBeGreaterThan(0)
    },
  )
})
