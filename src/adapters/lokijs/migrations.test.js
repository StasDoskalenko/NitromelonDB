import 'fake-indexeddb/auto'

import Loki from 'lokijs'

import { appSchema, tableSchema } from '../../Schema'
import { schemaMigrations, createTable, addColumns, destroyTable } from '../../Schema/migrations'
import logger from '../../utils/common/logger'
import Model from '../../Model'
import Query from '../../Query'

import LokiJSAdapter from './index'
import { destroyCollection } from './worker/lokiExtensions'
import DatabaseAdapterCompat from '../compat'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async (predicate) => {
  for (let i = 0; i < 200; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await predicate()) {
      return
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(5)
  }
  throw new Error('Timed out waiting for condition')
}

const getPersistedKeys = (dbName) =>
  new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(dbName)
    openRequest.onerror = () => reject(openRequest.error)
    openRequest.onsuccess = () => {
      const db = openRequest.result
      const request = db
        .transaction(['LokiIncrementalData'], 'readonly')
        .objectStore('LokiIncrementalData')
        .getAllKeys()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        db.close()
        resolve(request.result)
      }
    }
  })

const chunksOf = (keys, table) => keys.filter((key) => key.startsWith(`${table}.`)).sort()

const tasksSchema = { name: 'tasks', columns: [{ name: 'name', type: 'string' }] }
const commentsSchema = { name: 'comments', columns: [{ name: 'body', type: 'string' }] }

const bothTables = (version) =>
  appSchema({ version, tables: [tableSchema(tasksSchema), tableSchema(commentsSchema)] })
const schemaV1 = bothTables(1)
const schemaV2 = appSchema({ version: 2, tables: [tableSchema(tasksSchema)] })

let openAdapters = []

const openAdapter = async (dbName, schema, migrations, lazyCollections) => {
  const lokiAdapter = new LokiJSAdapter({
    dbName,
    schema,
    migrations: migrations && schemaMigrations({ migrations }),
    useWebWorker: false,
    useIncrementalIndexedDB: true,
    extraLokiOptions: { autosaveInterval: 5 },
    extraIncrementalIDBOptions: { lazyCollections },
  })
  openAdapters.push(lokiAdapter)
  const adapter = new DatabaseAdapterCompat(lokiAdapter)
  // wait for setup
  await adapter.getLocal('foo')
  return { adapter, loki: lokiAdapter._driver.loki }
}

// Waits until all changes are saved, and stops saving (like closing the page)
const closeAdapter = async ({ loki }) => {
  await waitFor(() => !loki.autosaveDirty())
  await new Promise((resolve) => loki.throttledSaveDrain(resolve))
  loki.autosaveDisable()
}

const comments = (count, prefix) =>
  Array.from({ length: count }, (_, i) => [
    'create',
    'comments',
    { id: `${prefix}${i}`, body: prefix, _status: '', _changed: '' },
  ])

class MockComment extends Model {
  static table = 'comments'
}

const countComments = (adapter) =>
  adapter.count(new Query({ modelClass: MockComment }, []).serialize())

afterEach(() => {
  openAdapters.forEach((lokiAdapter) => {
    const loki = lokiAdapter._driver?.loki
    loki && loki.autosaveDisable()
  })
  openAdapters = []
})

describe('LokiJSAdapter destroyTable() migrations', () => {
  it('warns if it cannot delete persisted data of a destroyed table', () => {
    const warn = jest.spyOn(logger, 'warn')
    // an incremental adapter that's not IncrementalIndexedDBAdapter
    const persistenceAdapter = { mode: 'incremental', saveDatabase: () => {} }
    const loki = new Loki('test', { adapter: persistenceAdapter })
    loki.addCollection('comments')

    destroyCollection(loki, 'comments')

    expect(loki.getCollection('comments')).toBe(null)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Cannot delete persisted data of destroyed table comments'),
    )
  })

  it.each([
    ['eagerly loaded', undefined],
    ['lazily loaded', ['comments']],
  ])('destroys %s tables, deleting their data from IndexedDB', async (_, lazyCollections) => {
    const dbName = `test${Math.random()}`
    const v1 = await openAdapter(dbName, schemaV1, undefined, lazyCollections)
    await v1.adapter.batch([
      ['create', 'tasks', { id: 't1', name: 'task', _status: '', _changed: '' }],
      ...comments(150, 'c'),
    ])
    await closeAdapter(v1)
    expect(chunksOf(await getPersistedKeys(dbName), 'comments')).toEqual([
      'comments.chunk.0',
      'comments.chunk.1',
      'comments.metadata',
    ])

    const migrations = [{ toVersion: 2, steps: [destroyTable({ table: 'comments' })] }]
    const v2 = await openAdapter(dbName, schemaV2, migrations, lazyCollections)
    expect(v2.loki.getCollection('comments')).toBe(null)
    await closeAdapter(v2)

    const keys = await getPersistedKeys(dbName)
    expect(chunksOf(keys, 'comments')).toEqual([])
    expect(chunksOf(keys, 'tasks')).toEqual(['tasks.chunk.0', 'tasks.metadata'])

    // loads fine after that
    const reopened = await openAdapter(dbName, schemaV2, migrations, lazyCollections)
    expect(reopened.loki.getCollection('comments')).toBe(null)
    expect((await reopened.adapter.find('tasks', 't1')).name).toBe('task')
  })

  it('deletes leftover data of tables that are already gone from Loki', async () => {
    const dbName = `test${Math.random()}`
    const v1 = await openAdapter(dbName, schemaV1)
    await v1.adapter.batch(comments(10, 'c'))
    await closeAdapter(v1)

    // e.g. the collection was removed from Loki by an older app version, but its chunks remain
    const removed = await openAdapter(dbName, schemaV1)
    removed.loki.collections = removed.loki.collections.filter(({ name }) => name !== 'comments')
    await removed.adapter.batch([
      ['create', 'tasks', { id: 't1', name: 'task', _status: '', _changed: '' }],
    ])
    await closeAdapter(removed)
    expect(chunksOf(await getPersistedKeys(dbName), 'comments')).not.toEqual([])

    const v2 = await openAdapter(dbName, schemaV2, [
      { toVersion: 2, steps: [destroyTable({ table: 'comments' })] },
    ])
    await closeAdapter(v2)
    expect(chunksOf(await getPersistedKeys(dbName), 'comments')).toEqual([])
  })

  it('keeps the old data if saving a destroyed table fails, and deletes it on retry', async () => {
    const dbName = `test${Math.random()}`
    const v1 = await openAdapter(dbName, schemaV1)
    await v1.adapter.batch(comments(250, 'old'))
    await closeAdapter(v1)
    const oldChunks = [
      'comments.chunk.0',
      'comments.chunk.1',
      'comments.chunk.2',
      'comments.metadata',
    ]

    // saving fails (and the IndexedDB transaction is aborted) until `failSaves` is unset
    let failSaves = true
    let failedSaves = 0
    const { put } = IDBObjectStore.prototype
    jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
      if (failSaves) {
        failedSaves += 1
        throw new Error('Simulated IndexedDB failure')
      }
      return put.apply(this, args)
    })

    const migrations = [
      {
        toVersion: 2,
        steps: [destroyTable({ table: 'comments' }), createTable(commentsSchema)],
      },
    ]
    const schema = bothTables(2)
    const v2 = await openAdapter(dbName, schema, migrations)
    await v2.adapter.batch(comments(150, 'new'))
    await waitFor(() => failedSaves >= 2)
    await sleep(20)

    // nothing was deleted by failed saves
    expect(chunksOf(await getPersistedKeys(dbName), 'comments')).toEqual(oldChunks)

    // retry succeeds
    failSaves = false
    await waitFor(() => !v2.loki.autosaveDirty())
    await v2.adapter.batch(comments(1, 'newer'))
    await closeAdapter(v2)

    expect(chunksOf(await getPersistedKeys(dbName), 'comments')).toEqual([
      'comments.chunk.0',
      'comments.chunk.1',
      'comments.metadata',
    ])
    const reopened = await openAdapter(dbName, schema, migrations)
    expect(await countComments(reopened.adapter)).toBe(151)
  })

  it('destroys and creates a table again in one migration', async () => {
    const dbName = `test${Math.random()}`
    const v1 = await openAdapter(dbName, schemaV1)
    await v1.adapter.batch(comments(250, 'old'))
    await closeAdapter(v1)

    const migrations = [
      {
        toVersion: 2,
        steps: [destroyTable({ table: 'comments' }), createTable(commentsSchema)],
      },
    ]
    const schema = bothTables(2)
    const v2 = await openAdapter(dbName, schema, migrations)
    expect(await countComments(v2.adapter)).toBe(0)
    await v2.adapter.batch(comments(150, 'new'))
    await waitFor(() => !v2.loki.autosaveDirty())
    // a later save only touches the last chunk - the first one must not be deleted again
    await v2.adapter.batch(comments(1, 'newer'))
    await closeAdapter(v2)

    expect(chunksOf(await getPersistedKeys(dbName), 'comments')).toEqual([
      'comments.chunk.0',
      'comments.chunk.1',
      'comments.metadata',
    ])
    const reopened = await openAdapter(dbName, schema, migrations)
    expect(await countComments(reopened.adapter)).toBe(151)
  })

  it('keeps the persisted database as it was if a migration fails after destroying a table', async () => {
    const dbName = `test${Math.random()}`
    const v1 = await openAdapter(dbName, schemaV1)
    await v1.adapter.batch(comments(150, 'old'))
    await closeAdapter(v1)

    const onSetUpError = jest.fn()
    const failing = new LokiJSAdapter({
      dbName,
      schema: bothTables(2),
      migrations: schemaMigrations({
        migrations: [
          {
            toVersion: 2,
            steps: [
              createTable({ name: 'tags', columns: [{ name: 'name', type: 'string' }] }),
              destroyTable({ table: 'comments' }),
              // fails: there's no such table
              addColumns({ table: 'missing', columns: [{ name: 'name', type: 'string' }] }),
            ],
          },
        ],
      }),
      useWebWorker: false,
      useIncrementalIndexedDB: true,
      extraLokiOptions: { autosaveInterval: 5 },
      onSetUpError,
    })
    openAdapters.push(failing)
    await waitFor(() => onSetUpError.mock.calls.length > 0)
    // longer than the autosave interval
    await sleep(50)

    expect(chunksOf(await getPersistedKeys(dbName), 'comments')).toEqual([
      'comments.chunk.0',
      'comments.chunk.1',
      'comments.metadata',
    ])
    const reopened = await openAdapter(dbName, schemaV1)
    expect(await countComments(reopened.adapter)).toBe(150)
  })

  // Incremental saves only write changed chunks, and loading reads every stored chunk of a
  // collection, so chunks left by the destroyed table would bring its records back
  it('creates a destroyed table again in a later migration, after reopening', async () => {
    const dbName = `test${Math.random()}`
    const v1 = await openAdapter(dbName, schemaV1)
    await v1.adapter.batch(comments(250, 'old'))
    await closeAdapter(v1)

    const destroy = { toVersion: 2, steps: [destroyTable({ table: 'comments' })] }
    const v2 = await openAdapter(dbName, schemaV2, [destroy])
    await closeAdapter(v2)

    const recreate = { toVersion: 3, steps: [createTable(commentsSchema)] }
    const v3 = await openAdapter(dbName, bothTables(3), [destroy, recreate])
    await v3.adapter.batch(comments(1, 'new'))
    await closeAdapter(v3)

    const reopened = await openAdapter(dbName, bothTables(3), [destroy, recreate])
    expect(await countComments(reopened.adapter)).toBe(1)
  })
})
