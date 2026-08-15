import { Database, Q } from 'nitromelondb'
import SQLiteAdapter from 'nitromelondb/adapters/sqlite'
import { releaseCollectionCache } from '../shared/releaseCache'
import type { BenchmarkAdapter, QueryBreakdown } from '../shared/types'
import Item from './model/Item'
import { ITEMS_TABLE, schema } from './model/schema'

export function createNitromelonAdapter(): BenchmarkAdapter {
  const sqlite = new SQLiteAdapter({
    schema,
    dbName: 'nitromelon-benchmark',
    onSetUpError: (error) => {
      console.error('[NitromelonDB] Failed to set up SQLite', error)
    },
  })

  const database = new Database({
    adapter: sqlite,
    modelClasses: [Item],
  })
  const items = database.get<Item>(ITEMS_TABLE)
  const engine = sqlite._dispatcherType === 'nitro' ? 'Nitro SQLite' : sqlite._dispatcherType

  return {
    label: 'NitromelonDB',
    engine,
    async reset() {
      await database.write(async () => {
        await database.unsafeResetDatabase()
      })
    },
    async insertBatch(startIndex, count) {
      await database.write(async () => {
        const operations = []
        const end = startIndex + count
        for (let index = startIndex; index < end; index += 1) {
          operations.push(
            items.prepareCreate((item) => {
              item.title = `item-${index}`
              item.value = index % 1000
              item.createdAt = index
            }),
          )
        }
        await database.batch(operations)
      })
      releaseCollectionCache(items)
    },
    async runQueries(): Promise<QueryBreakdown> {
      const countAll = await items.query().fetchCount()
      const countFiltered = await items.query(Q.where('value', 42)).fetchCount()
      // unsafeFetchRaw always returns full rows. fetch() would ask for IDs that
      // native still thinks are cached after releaseCollectionCache().
      const filtered = await items.query(Q.where('value', 42)).unsafeFetchRaw()
      const page = await items.query(Q.sortBy('created_at', Q.desc), Q.take(100)).unsafeFetchRaw()
      const countHigh = await items.query(Q.where('value', Q.gte(990))).fetchCount()
      return {
        countAll,
        countFiltered,
        fetchFiltered: filtered.length,
        fetchPage: page.length,
        countHigh,
      }
    },
    async deleteBatch(count) {
      const ids = await items.query(Q.take(count)).fetchIds()
      if (ids.length === 0) {
        return 0
      }
      await database.write(async () => {
        await database.adapter.batch(ids.map((id) => ['destroyPermanently', ITEMS_TABLE, id]))
      })
      releaseCollectionCache(items)
      return ids.length
    },
  }
}
