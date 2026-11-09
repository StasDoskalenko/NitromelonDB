/* eslint-disable jest/no-standalone-expect */
import * as Q from '../../../QueryDescription'
import { taskQuery, mockTaskRaw } from '../helpers'
import { createFileAdapter, openFileAdapter, cleanupDb } from './helpers'

/**
 * Numbers are stored as REAL unless the app opts into storeWholeNumbersAsIntegers, which also
 * converts rows written before it was turned on.
 */
const STATE_KEY = '__nitromelondb_number_storage'

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

  it('numbers behave as REAL in SQL by default', async (_adapter, AdapterClass, _extra, platform) => {
    // wa-sqlite already binds 32-bit whole numbers as INTEGER
    if (AdapterClass.name === 'LokiJSAdapter' || platform === 'web') return

    const { adapter } = await createFileAdapter(platform)
    await adapter.batch([['create', 'tasks', mockTaskRaw({ id: 'seven', num1: 7 })]])
    const [row] = await adapter.unsafeQueryRaw(
      taskQuery(
        Q.unsafeSqlQuery(
          "select typeof(num1) as type, num1 / 2 as half, num1 || '' as text from tasks where id = 'seven'",
        ),
      ),
    )
    expect(row.type).toBe('real')
    expect(row.half).toBe(3.5)
    expect(row.text).toBe('7.0')
  })

  it('storeWholeNumbersAsIntegers stores whole numbers as INTEGER', async (_adapter, AdapterClass, _extra, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform, { storeWholeNumbersAsIntegers: true })
    const [table] = await adapter.unsafeQueryRaw(
      taskQuery(Q.unsafeSqlQuery("select sql from sqlite_master where name = 'tasks'")),
    )
    // Untyped: a REAL column would turn the INTEGERs back into REAL
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
    // The web adapter ignores the option
    if (platform === 'web') return
    expect(types.whole).toBe('integer')
    expect(types.timestamp).toBe('integer')
  })

  it('storeWholeNumbersAsIntegers converts rows written before it was turned on, and back when turned off', async (_adapter, AdapterClass, _extra, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter' || platform === 'web') return

    // Each step opens another adapter on the same file, keeping the earlier ones open: native can't
    // reopen a file it closed in the same process. Each adapter has its own connection and option
    const { adapter: before, underlying: beforeUnderlying, dbName } = await createFileAdapter(platform)
    // Never turned on: nothing to convert, nothing written
    expect(await beforeUnderlying.numberStorageConversion).toBe('unchanged')
    expect(await before.getLocal(STATE_KEY)).toBe(null)

    // More rows than one conversion transaction takes, so it walks several rowid ranges
    const count = 4500
    const expected = new Map()
    const operations = []
    for (let i = 0; i < count; i += 1) {
      const num1 = i % 3 === 0 ? i + 0.5 : 1700000000000 + i
      expected.set(`t${i}`, num1)
      operations.push(['create', 'tasks', mockTaskRaw({ id: `t${i}`, num1, _status: 'synced' })])
    }
    operations.push(['create', 'tasks', mockTaskRaw({ id: 'big', num1: 2 ** 53 + 2 })])
    expected.set('big', 2 ** 53 + 2)
    await before.batch(operations)
    const statuses = await before.unsafeQueryRaw(
      taskQuery(Q.unsafeSqlQuery('select id, _status, _changed from tasks order by id')),
    )
    const readAll = (adapter) =>
      adapter.unsafeQueryRaw(
        taskQuery(Q.unsafeSqlQuery('select id, num1, typeof(num1) as type from tasks')),
      )
    const mismatches = (rows, wholeNumbersAs) =>
      rows
        .filter((row) => {
          const num1 = expected.get(row.id)
          const isWhole = Number.isInteger(num1) && Math.abs(num1) <= 2 ** 53
          return row.num1 !== num1 || row.type !== (isWhole ? wholeNumbersAs : 'real')
        })
        .slice(0, 3)

    // Turned on: converted to INTEGER
    const { adapter: on, underlying: onUnderlying } = await openFileAdapter(dbName, {
      storeWholeNumbersAsIntegers: true,
    })
    expect(await onUnderlying.numberStorageConversion).toBe('converted')
    const converted = await readAll(on)
    expect(converted.length).toBe(count + 1)
    expect(mismatches(converted, 'integer')).toEqual([])
    // Sync doesn't see it as a change
    expect(
      await on.unsafeQueryRaw(
        taskQuery(Q.unsafeSqlQuery('select id, _status, _changed from tasks order by id')),
      ),
    ).toEqual(statuses)
    expect(await on.getLocal(STATE_KEY)).toBe('integer')

    // Next launch: already done
    const { underlying: onAgain } = await openFileAdapter(dbName, {
      storeWholeNumbersAsIntegers: true,
    })
    expect(await onAgain.numberStorageConversion).toBe('unchanged')

    // Turned off again (a rolled-back release): converted back, raw SQL sees REAL again
    const { adapter: off, underlying: offUnderlying } = await openFileAdapter(dbName)
    expect(await offUnderlying.numberStorageConversion).toBe('converted')
    expect(mismatches(await readAll(off), 'real')).toEqual([])
    const [row] = await off.unsafeQueryRaw(
      taskQuery(Q.unsafeSqlQuery("select num1 / 2 as half from tasks where id = 't1'")),
    )
    expect(row.half).toBe((1700000000000 + 1) / 2)
    expect(await off.getLocal(STATE_KEY)).toBe(null)
    const { underlying: offAgain } = await openFileAdapter(dbName)
    expect(await offAgain.numberStorageConversion).toBe('unchanged')

    cleanupDb(dbName, platform)
  })

  it('storeWholeNumbersAsIntegers finishes an interrupted conversion, in either direction', async (_adapter, AdapterClass, _extra, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter' || platform === 'web') return

    // Turned on, the app closed before converting finished: it continues on the next launch
    const { adapter: first, dbName } = await createFileAdapter(platform)
    await first.batch([['create', 'tasks', mockTaskRaw({ id: 'seven', num1: 7 })]])
    await first.setLocal(STATE_KEY, 'to-integer')
    const { adapter: on, underlying: onUnderlying } = await openFileAdapter(dbName, {
      storeWholeNumbersAsIntegers: true,
    })
    expect(await onUnderlying.numberStorageConversion).toBe('converted')
    const typeOfSeven = async (adapter) =>
      (
        await adapter.unsafeQueryRaw(
          taskQuery(Q.unsafeSqlQuery("select typeof(num1) as type from tasks where id = 'seven'")),
        )
      )[0].type
    expect(await typeOfSeven(on)).toBe('integer')

    // Turned on, interrupted, then turned off before it finished: whatever was converted goes back
    await on.setLocal(STATE_KEY, 'to-integer')
    const { adapter: off, underlying: offUnderlying } = await openFileAdapter(dbName)
    expect(await offUnderlying.numberStorageConversion).toBe('converted')
    expect(await typeOfSeven(off)).toBe('real')
    expect(await off.getLocal(STATE_KEY)).toBe(null)

    cleanupDb(dbName, platform)
  })
}
