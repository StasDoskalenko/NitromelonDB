import { Database } from '@nozbe/watermelondb'
import type { Collection } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import Item from './model/Item'
import { ITEMS_TABLE, schema } from './model/schema'

// Reference point for NitromelonDB's "Mass delete: old vs new" card (see the sibling
// nitromelondb_benchmark app): plain upstream WatermelonDB has no destroyMatching()
// equivalent, so this just times what Query#destroyAllPermanently() has always done here --
// one database.batch() call (one adapter transaction) per matching record. Same shape (record
// counts, seeding) as the NitromelonDB card's "old" column, so the two are directly comparable.

export type MassDeleteResult = {
  count: number
  ms: number
}

type ItemDatabase = { database: Database; items: Collection<Item> }

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

async function makeDatabase(): Promise<ItemDatabase> {
  const adapter = new SQLiteAdapter({ schema, dbName: 'watermelon-massdelete', jsi: true })
  const database = new Database({ adapter, modelClasses: [Item] })
  return { database, items: database.get<Item>(ITEMS_TABLE) }
}

async function reset(database: Database): Promise<void> {
  await database.write(() => database.unsafeResetDatabase())
}

async function seed(items: Collection<Item>, count: number): Promise<void> {
  await items.database.write(async () => {
    const operations = []
    for (let index = 0; index < count; index += 1) {
      operations.push(
        items.prepareCreate((item) => {
          item.title = `item-${index}`
          item.value = index % 1000
          item.createdAt = index
        }),
      )
    }
    await items.database.batch(operations)
  })
}

// WatermelonDB's own destroyAllPermanently(): fetches full Model instances, then destroys each
// one via its own database.batch() call -- one adapter transaction per record. Unlike
// NitromelonDB, this is simply what the method does -- there's no faster path to compare it to
// here.
async function destroyAllPermanently(items: Collection<Item>): Promise<void> {
  const records = await items.query().fetch()
  await items.database.write(async () => {
    for (const record of records) {
      // eslint-disable-next-line no-await-in-loop
      await items.database.batch(record.prepareDestroyPermanently())
    }
  })
}

let db: ItemDatabase | null = null

async function getDb(): Promise<ItemDatabase> {
  db ??= await makeDatabase()
  return db
}

export async function runMassDeleteBenchmark(count: number): Promise<MassDeleteResult> {
  const { database, items } = await getDb()
  await reset(database)
  await seed(items, count)
  const started = now()
  await destroyAllPermanently(items)
  const ms = now() - started
  return { count, ms }
}
