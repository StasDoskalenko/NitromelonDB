/* eslint-disable jest/no-standalone-expect */
import * as Q from '../../../QueryDescription'
import { taskQuery, mockTaskRaw } from '../helpers'
import { createFileAdapter } from './helpers'

/**
 * Number columns are declared REAL (encodeSchema), so SQLite stores whole numbers compactly on disk.
 * That must not change anything a query can see: values, types and arithmetic stay those of REAL.
 */
export default (it) => {
  it('numbers read back exactly, whole or not', async (_adapter, AdapterClass, _extra, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)

    const values = [
      0,
      1,
      -1,
      42,
      1.5,
      0.1,
      -2.25,
      1700000000123,
      2 ** 53,
      -(2 ** 53),
      2 ** 53 + 2,
      1e300,
      -1e-300,
    ]
    await adapter.batch(
      values.map((num1, i) => ['create', 'tasks', mockTaskRaw({ id: `n${i}`, num1 })]),
    )

    // -0 reads back as 0 or -0 depending on the adapter: better-sqlite3 returns it as 0
    await adapter.batch([['create', 'tasks', mockTaskRaw({ id: 'negativeZero', num1: -0 })]])

    const rows = await adapter.unsafeQueryRaw(taskQuery())
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.num1]))
    // Object.is, so that -0 has to stay -0; a string, so a mismatch names the value
    values.forEach((num1, i) => {
      const read = byId[`n${i}`]
      expect(
        Object.is(read, num1) ? 'same' : `wrote ${Object.is(num1, -0) ? '-0' : num1}, read ${read}`,
      ).toBe('same')
    })
    expect(byId.negativeZero === 0).toBe(true)
  })

  it('number columns are declared REAL, and behave as REAL in SQL', async (_adapter, AdapterClass, _extra, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform)
    const [table] = await adapter.unsafeQueryRaw(
      taskQuery(Q.unsafeSqlQuery("select sql from sqlite_master where name = 'tasks'")),
    )
    expect(table.sql.includes('"num1" real')).toBe(true)
    expect(table.sql.includes('"text1" real')).toBe(false)

    await adapter.batch([['create', 'tasks', mockTaskRaw({ id: 'seven', num1: 7 })]])
    const [row] = await adapter.unsafeQueryRaw(
      taskQuery(
        Q.unsafeSqlQuery(
          "select typeof(num1) as type, num1 / 2 as half, num1 || '' as text from tasks where id = 'seven'",
        ),
      ),
    )
    // The same as before number columns had a type: stored as REAL, so no integer division
    expect(row.type).toBe('real')
    expect(row.half).toBe(3.5)
    expect(row.text).toBe('7.0')
  })

  it('storeWholeNumbersAsIntegers stores whole numbers as INTEGER (native)', async (_adapter, AdapterClass, _extra, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform, { storeWholeNumbersAsIntegers: true })
    const [table] = await adapter.unsafeQueryRaw(
      taskQuery(Q.unsafeSqlQuery("select sql from sqlite_master where name = 'tasks'")),
    )
    // A REAL column would turn the INTEGERs back into REAL
    expect(table.sql.includes('"num1" real')).toBe(false)

    const values = { whole: 42, timestamp: 1700000000123, fraction: 1.5, beyondExact: 2 ** 53 + 2 }
    await adapter.batch(
      Object.entries(values).map(([id, num1]) => ['create', 'tasks', mockTaskRaw({ id, num1 })]),
    )
    const rows = await adapter.unsafeQueryRaw(
      taskQuery(Q.unsafeSqlQuery('select id, num1, typeof(num1) as type from tasks')),
    )
    for (const row of rows) {
      expect(row.num1).toBe(values[row.id])
    }
    const types = Object.fromEntries(rows.map((row) => [row.id, row.type]))
    expect(types.fraction).toBe('real')
    expect(types.beyondExact).toBe('real')
    // The option is native only: the Node and web adapters bind every JS number as REAL
    if (platform === 'node' || platform === 'web') return
    expect(types.whole).toBe('integer')
    expect(types.timestamp).toBe('integer')
  })
}
