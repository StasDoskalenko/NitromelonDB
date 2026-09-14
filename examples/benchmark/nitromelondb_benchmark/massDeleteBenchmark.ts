import { Database } from 'nitromelondb'
import type { Collection } from 'nitromelondb'
import SQLiteAdapter from 'nitromelondb/adapters/sqlite'
import Item from './model/Item'
import { ITEMS_TABLE, schema } from './model/schema'

// A separate, dedicated database from the main write/query/delete comparison harness
// (createNitromelonAdapter's `nitromelon-benchmark`) -- this benchmark measures one thing only:
// Query#destroyAllPermanently() before this PR (one database.batch() call -- one adapter
// transaction -- per matching record) vs after (one adapter.destroyMatching() call total,
// regardless of match count). See src/adapters/__tests__/sqliteTests/destroyAll.benchmark.js for
// the same comparison against a real file-backed SQLite database via Node/better-sqlite3; this is
// the same idea against whatever this device's actual native SQLite engine is.

export type MassDeleteResult = {
  count: number
  oldMs: number
  newMs: number
}

type ItemDatabase = { database: Database; items: Collection<Item> }

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

async function makeDatabase(dbName: string): Promise<ItemDatabase> {
  const adapter = new SQLiteAdapter({ schema, dbName })
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

// Faithful to the pre-PR Query#destroyAllPermanently(): fetch full Model instances, then destroy
// each one via its own database.batch() call -- one adapter transaction per record.
async function oldDestroyAllPermanently(items: Collection<Item>): Promise<void> {
  const records = await items.query().fetch()
  await items.database.write(async () => {
    for (const record of records) {
      // eslint-disable-next-line no-await-in-loop
      await items.database.batch(record.prepareDestroyPermanently())
    }
  })
}

async function newDestroyAllPermanently(items: Collection<Item>): Promise<void> {
  await items.database.write(() => items.query().destroyAllPermanently())
}

let oldDb: ItemDatabase | null = null
let newDb: ItemDatabase | null = null

async function getDb(which: 'old' | 'new'): Promise<ItemDatabase> {
  if (which === 'old') {
    oldDb ??= await makeDatabase('nitromelon-massdelete-old')
    return oldDb
  }
  newDb ??= await makeDatabase('nitromelon-massdelete-new')
  return newDb
}

export async function runMassDeleteBenchmark(count: number): Promise<MassDeleteResult> {
  const old = await getDb('old')
  await reset(old.database)
  await seed(old.items, count)
  const oldStart = now()
  await oldDestroyAllPermanently(old.items)
  const oldMs = now() - oldStart

  const fresh = await getDb('new')
  await reset(fresh.database)
  await seed(fresh.items, count)
  const newStart = now()
  await newDestroyAllPermanently(fresh.items)
  const newMs = now() - newStart

  return { count, oldMs, newMs }
}
