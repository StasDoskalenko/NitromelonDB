import { Database, Q } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import { releaseCollectionCache } from '../shared/releaseCache'
import type { BenchmarkAdapter, QueryBreakdown } from '../shared/types'
import Item from './model/Item'
import { ITEMS_TABLE, schema } from './model/schema'

export function createWatermelonAdapter(): BenchmarkAdapter {
  const sqlite = new SQLiteAdapter({
    schema,
    dbName: 'watermelon-benchmark',
    jsi: true,
    onSetUpError: (error) => {
      console.error('[WatermelonDB] Failed to set up SQLite', error)
    },
  })

  const database = new Database({
    adapter: sqlite,
    modelClasses: [Item],
  })
  const items = database.get<Item>(ITEMS_TABLE)
  const dispatcher =
    '_dispatcherType' in sqlite ? String((sqlite as { _dispatcherType?: string })._dispatcherType) : 'jsi'

  return {
    label: 'WatermelonDB',
    engine: dispatcher === 'jsi' ? 'WatermelonDB SQLite (JSI)' : `WatermelonDB SQLite (${dispatcher})`,
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
