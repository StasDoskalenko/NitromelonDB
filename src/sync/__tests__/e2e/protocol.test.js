// The reference server against the numbered rules in docs-website/docs/docs/Sync/Backend.md, with
// raw HTTP requests (no app involved). If you write your own backend, these are the behaviors the
// app relies on.
import { setUpServer, SyncHttpError } from './helpers'

const server = setUpServer()

const empty = { created: [], updated: [], deleted: [] }
const pull = (lastPulledAt, extra = {}) => {
  const query = new URLSearchParams({
    last_pulled_at: lastPulledAt ? String(lastPulledAt) : '',
    schema_version: '2',
    ...extra,
  })
  return server.request('GET', `/sync/pull?${query}`)
}
const push = (lastPulledAt, changes) =>
  server.request('POST', '/sync/push', { lastPulledAt, changes })
const pushError = (lastPulledAt, changes) =>
  push(lastPulledAt, changes).then(
    () => null,
    (error) => error,
  )
const project = (id, name = `Project ${id}`) => ({ id, name, is_favorite: false })

describe('Sync server protocol', () => {
  it('returns every record on the first pull, without tombstones or change-tracking columns (pull 3, 8, 10)', async () => {
    const { timestamp: t0 } = await pull(null)
    await push(t0, { projects: { ...empty, created: [project('keep'), project('gone')] } })
    const { timestamp: t1 } = await pull(t0)
    await push(t1, { projects: { ...empty, deleted: ['gone'] } })

    const { changes } = await pull(null)
    expect(changes.projects).toEqual({ created: [], updated: [project('keep')], deleted: [] })
    expect(Object.keys(changes.projects.updated[0]).sort()).toEqual(['id', 'is_favorite', 'name'])
  })

  it('returns changes and deletions since lastPulledAt, and a timestamp that continues from there (pull 2, 4)', async () => {
    const { timestamp: t0 } = await pull(null)
    await push(t0, { projects: { ...empty, created: [project('a'), project('b')] } })
    const first = await pull(t0)
    expect(first.changes.projects.updated.map((p) => p.id).sort()).toEqual(['a', 'b'])
    expect(first.timestamp).toBeGreaterThan(t0)

    await push(first.timestamp, {
      projects: { ...empty, updated: [{ id: 'a', name: 'A2' }], deleted: ['b'] },
    })
    const second = await pull(first.timestamp)
    expect(second.changes.projects).toEqual({
      created: [],
      updated: [{ id: 'a', name: 'A2', is_favorite: false }],
      deleted: ['b'],
    })
    // Nothing new since then
    expect((await pull(second.timestamp)).changes.projects).toEqual(empty)
  })

  it('updates a pushed `created` record that already exists instead of failing (push 2)', async () => {
    const { timestamp } = await pull(null)
    await push(timestamp, { projects: { ...empty, created: [project('a', 'First')] } })
    const { timestamp: later } = await pull(timestamp)
    await push(later, { projects: { ...empty, created: [project('a', 'Second')] } })
    expect((await server.dump()).projects).toEqual([
      expect.objectContaining({ id: 'a', name: 'Second' }),
    ])
  })

  it('creates a pushed `updated` record it has never seen (push 3)', async () => {
    const { timestamp } = await pull(null)
    await push(timestamp, { projects: { ...empty, updated: [project('new')] } })
    expect((await server.dump()).projects).toEqual([expect.objectContaining({ id: 'new' })])
  })

  it('ignores deletions of records it does not have (push 4)', async () => {
    const { timestamp } = await pull(null)
    await push(timestamp, { projects: { ...empty, deleted: ['nonexistent'] } })
    expect((await server.dump()).projects).toEqual([])
  })

  it('rejects a push touching records changed since lastPulledAt, and applies none of it (push 5, 7)', async () => {
    const { timestamp: t0 } = await pull(null)
    await push(t0, { tasks: { ...empty, created: [{ id: 'task', name: 'v1' }] } })
    const { timestamp: t1 } = await pull(t0)
    await push(t1, { tasks: { ...empty, updated: [{ id: 'task', name: 'v2' }] } })

    // Based on t1, so it hasn't seen v2. The new project in the same push must not be written.
    const error = await pushError(t1, {
      projects: { ...empty, created: [project('new')] },
      tasks: { ...empty, updated: [{ id: 'task', name: 'stale' }] },
    })
    expect(error).toBeInstanceOf(SyncHttpError)
    expect(error.status).toBe(409)
    expect(error.body.conflicts).toEqual([{ table: 'tasks', id: 'task' }])
    const dump = await server.dump()
    expect(dump.projects).toEqual([])
    expect(dump.tasks[0].name).toBe('v2')

    // Deleting a record changed since lastPulledAt is a conflict too
    expect((await pushError(t1, { tasks: { ...empty, deleted: ['task'] } })).status).toBe(409)
  })

  it('ignores _status, _changed and unknown columns, and fixes values of the wrong type (push 8, 10)', async () => {
    const { timestamp } = await pull(null)
    await push(timestamp, {
      tasks: {
        ...empty,
        created: [
          {
            id: 'task',
            _status: 'created',
            _changed: 'name',
            name: 42,
            position: 'first',
            is_completed: 'yes',
            description: 7,
            last_modified: 0,
            deleted: 1,
            unknown_column: 'x',
          },
        ],
      },
    })
    const { changes } = await pull(null)
    expect(changes.tasks.updated).toEqual([
      {
        id: 'task',
        project_id: '',
        name: '',
        description: null,
        position: 0,
        is_completed: false,
        priority: 0,
      },
    ])
  })

  it('validates the shape of a push (push 9)', async () => {
    const { timestamp } = await pull(null)
    const statusOf = async (body) =>
      (
        await server.request('POST', '/sync/push', body).then(
          () => null,
          (error) => error,
        )
      )?.status

    expect(await statusOf({ changes: { projects: empty } })).toBe(400) // no lastPulledAt
    expect(await statusOf({ lastPulledAt: timestamp, changes: [] })).toBe(400)
    expect(await statusOf({ lastPulledAt: timestamp, changes: { not_a_table: empty } })).toBe(400)
    expect(await statusOf({ lastPulledAt: timestamp, changes: { __proto__x: empty } })).toBe(400)
    expect(
      await statusOf({
        lastPulledAt: timestamp,
        changes: { projects: { ...empty, created: 'nope' } },
      }),
    ).toBe(400)
    expect(
      await statusOf({
        lastPulledAt: timestamp,
        changes: { projects: { ...empty, created: [{ id: 'a b' }] } },
      }),
    ).toBe(400)
    expect(
      await statusOf({
        lastPulledAt: timestamp,
        changes: { projects: { ...empty, deleted: [5] } },
      }),
    ).toBe(400)
    expect((await server.dump()).projects).toEqual([])
  })

  it('deletes descendants of deleted records (push 11)', async () => {
    const { timestamp: t0 } = await pull(null)
    await push(t0, {
      projects: { ...empty, created: [project('p')] },
      tasks: { ...empty, created: [{ id: 't', project_id: 'p', name: 'Task' }] },
      comments: { ...empty, created: [{ id: 'c', task_id: 't', body: 'Comment' }] },
    })
    const { timestamp: t1 } = await pull(t0)
    await push(t1, { projects: { ...empty, deleted: ['p'] } })

    const { changes } = await pull(t1)
    expect(changes.projects.deleted).toEqual(['p'])
    expect(changes.tasks.deleted).toEqual(['t'])
    expect(changes.comments.deleted).toEqual(['c'])
  })

  it('sends every record of a table the app added in a migration (pull 6)', async () => {
    const { timestamp: t0 } = await pull(null)
    await push(t0, { comments: { ...empty, created: [{ id: 'old', body: 'From before' }] } })
    const { timestamp: t1 } = await pull(t0)

    const migration = JSON.stringify({ from: 1, tables: ['comments'], columns: [] })
    const { changes } = await pull(t1, { migration })
    expect(changes.comments.updated.map((c) => c.id)).toEqual(['old'])
    expect(changes.projects).toEqual(empty)
  })

  it('validates pull parameters', async () => {
    const statusOf = async (query) =>
      (
        await server.request('GET', `/sync/pull?${query}`).then(
          () => null,
          (error) => error,
        )
      )?.status
    expect(await statusOf('last_pulled_at=abc')).toBe(400)
    expect(await statusOf('migration=%7Bnope')).toBe(400)
    expect(await statusOf(`migration=${encodeURIComponent(JSON.stringify({ from: 1 }))}`)).toBe(400)
  })

  it('hands out strictly increasing timestamps, even for back-to-back pushes', async () => {
    let { timestamp } = await pull(null)
    for (let i = 0; i < 20; i += 1) {
      await push(timestamp, { projects: { ...empty, updated: [project(`p${i}`)] } })
      const next = await pull(timestamp)
      expect(next.timestamp).toBeGreaterThan(timestamp)
      expect(next.changes.projects.updated.map((p) => p.id)).toEqual([`p${i}`])
      timestamp = next.timestamp
    }
  })
})
