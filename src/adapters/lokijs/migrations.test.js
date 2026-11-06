import 'fake-indexeddb/auto'

import { appSchema, tableSchema } from '../../Schema'
import { schemaMigrations, destroyTable } from '../../Schema/migrations'
import Model from '../../Model'
import Query from '../../Query'

import LokiJSAdapter from './index'
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

const schemaV1 = appSchema({
  version: 1,
  tables: [tableSchema(tasksSchema), tableSchema(commentsSchema)],
})
const schemaV2 = appSchema({ version: 2, tables: [tableSchema(tasksSchema)] })
const migrations = [{ toVersion: 2, steps: [destroyTable({ table: 'comments' })] }]

let openAdapters = []

const openAdapter = async (dbName, schema, { migrations: migrationList, lazyCollections } = {}) => {
  const lokiAdapter = new LokiJSAdapter({
    dbName,
    schema,
    migrations: migrationList && schemaMigrations({ migrations: migrationList }),
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

class MockTask extends Model {
  static table = 'tasks'
}

const countTasks = (adapter) => adapter.count(new Query({ modelClass: MockTask }, []).serialize())

afterEach(() => {
  openAdapters.forEach((lokiAdapter) => {
    const loki = lokiAdapter._driver?.loki
    loki && loki.autosaveDisable()
  })
  openAdapters = []
})

describe('LokiJSAdapter destroyTable() migrations with IncrementalIndexedDBAdapter', () => {
  it.each([
    ['eagerly loaded', undefined],
    ['lazily loaded', ['comments']],
  ])('destroys a persisted, %s table and keeps the rest', async (_, lazyCollections) => {
    const dbName = `test${Math.random()}`
    const v1 = await openAdapter(dbName, schemaV1, { lazyCollections })
    await v1.adapter.batch([
      ['create', 'tasks', { id: 't1', name: 'task', _status: '', _changed: '' }],
      ...Array.from({ length: 150 }, (__, i) => [
        'create',
        'comments',
        { id: `c${i}`, body: 'comment', _status: '', _changed: '' },
      ]),
    ])
    await closeAdapter(v1)

    const v2 = await openAdapter(dbName, schemaV2, { migrations, lazyCollections })
    expect(v2.loki.getCollection('comments')).toBe(null)
    expect((await v2.adapter.find('tasks', 't1')).name).toBe('task')
    await v2.adapter.batch([
      ['create', 'tasks', { id: 't2', name: 'task 2', _status: '', _changed: '' }],
    ])
    await closeAdapter(v2)

    // the destroyed table's chunks stay in IndexedDB, but are ignored on load
    expect(chunksOf(await getPersistedKeys(dbName), 'comments')).not.toEqual([])

    const reopened = await openAdapter(dbName, schemaV2, { migrations, lazyCollections })
    expect(reopened.loki.getCollection('comments')).toBe(null)
    expect(reopened.loki.collections.map((collection) => collection.name).sort()).toEqual([
      'local_storage',
      'tasks',
    ])
    expect(await countTasks(reopened.adapter)).toBe(2)
    expect((await reopened.adapter.find('tasks', 't2')).name).toBe('task 2')
  })
})
