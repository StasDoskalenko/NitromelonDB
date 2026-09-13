/* eslint-disable no-console */
// Not picked up by `yarn jest`/`yarn test` (its name doesn't match jest.config.js's testMatch).
// Run explicitly: `yarn benchmark:destroy-all` (see package.json).
//
// Compares real wall-clock time, against a real file-backed SQLite database (better-sqlite3,
// the same engine `yarn test` already exercises via sqlite-node), between:
//   - "old": what every `Query#markAllAsDeleted()`/`destroyAllPermanently()` did before this PR
//     -- one `database.batch()` call (one adapter transaction) per matching record
//   - "new": what it does now -- one `adapter.destroyMatching()` call total, regardless of how
//     many records match (see Database#_performMassDestroy / each DatabaseAdapter#destroyMatching)
//
// Sample output (M-series MacBook, your numbers will vary with disk/CPU):
//   | records | old (ms)   | new (ms)   | speedup  |
//   | ------ | ---------- | ---------- | -------- |
//   |     50 |     13.1ms |      0.5ms |    27.5x |
//   |    200 |     40.6ms |      0.5ms |    76.3x |
//   |   1000 |    212.3ms |      1.7ms |   128.7x |
//   |   5000 |   1611.7ms |     11.3ms |   142.6x |

import Model from '../../../Model'
import Database from '../../../Database'
import { appSchema, tableSchema } from '../../../Schema'
import { field } from '../../../decorators'
import { toPromise } from '../../../utils/fp/Result'
import SQLiteAdapter from '../../sqlite/index'
import { fileDbName, cleanupDb } from './helpers'

const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'items',
      columns: [{ name: 'position', type: 'number' }],
    }),
  ],
})

class Item extends Model {
  static table = 'items'

  @field('position')
  position
}

async function makeDatabase() {
  if (!require('fs').existsSync('.tmp')) {
    require('fs').mkdirSync('.tmp')
  }
  const dbName = fileDbName('node')
  const adapter = new SQLiteAdapter({ dbName, schema })
  await adapter.initializingPromise
  const database = new Database({ adapter, modelClasses: [Item] })
  return { database, adapter, items: database.get(Item), dbName }
}

async function closeAndCleanup({ adapter, dbName }) {
  await toPromise((callback) => adapter.unsafeCloseConnection(callback))
  cleanupDb(dbName, 'node')
}

async function seed(items, count) {
  await items.database.write(async () => {
    const batch = []
    for (let i = 0; i < count; i += 1) {
      batch.push(items.prepareCreate((item) => (item.position = i)))
    }
    await items.database.batch(batch)
  })
}

// Faithful to the pre-PR implementation: fetch full Model instances, then destroy each one via
// its own database.batch() call -- one adapter transaction per record.
async function oldDestroyAllPermanently(items) {
  const records = await items.query().fetch()
  await items.database.write(async () => {
    for (const record of records) {
      // eslint-disable-next-line no-await-in-loop
      await items.database.batch(record.prepareDestroyPermanently())
    }
  })
}

async function newDestroyAllPermanently(items) {
  await items.database.write(() => items.query().destroyAllPermanently())
}

async function timeMs(action) {
  const started = performance.now()
  await action()
  return performance.now() - started
}

async function runOne(count) {
  const oldDb = await makeDatabase()
  await seed(oldDb.items, count)
  const oldMs = await timeMs(() => oldDestroyAllPermanently(oldDb.items))
  await closeAndCleanup(oldDb)

  const newDb = await makeDatabase()
  await seed(newDb.items, count)
  const newMs = await timeMs(() => newDestroyAllPermanently(newDb.items))
  await closeAndCleanup(newDb)

  return { count, oldMs, newMs }
}

describe('destroyAllPermanently benchmark (old per-record batch loop vs new destroyMatching)', () => {
  it('reports real wall-clock timing at increasing scale', async () => {
    const sampleSizes = [50, 200, 1000, 5000]
    const results = []
    for (const count of sampleSizes) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await runOne(count))
    }

    const fmt = (ms) => `${ms.toFixed(1)}ms`
    const rows = results.map(
      ({ count, oldMs, newMs }) =>
        `| ${String(count).padStart(6)} | ${fmt(oldMs).padStart(10)} | ${fmt(newMs).padStart(10)} | ${`${(oldMs / newMs).toFixed(1)}x`.padStart(8)} |`,
    )
    console.log(`
destroyAllPermanently: old (N transactions) vs new (destroyMatching, 1 op) -- real-sqlite-node timing
| records | old (ms)   | new (ms)   | speedup  |
| ------ | ---------- | ---------- | -------- |
${rows.join('\n')}
`)

    // Sanity, not the point of this file: the new implementation should never be slower.
    results.forEach(({ oldMs, newMs }) => {
      expect(newMs).toBeLessThan(oldMs)
    })
  }, 120000)
})
