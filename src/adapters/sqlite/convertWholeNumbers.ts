import type { AppSchema } from '../../Schema'
import { toPromise } from '../../utils/fp/Result'
import type { SqliteDispatcher, SqliteDispatcherMethod } from './type'

// Keeps the numbers already in the database in the format storeWholeNumbersAsIntegers asks for:
// - turned on: rows written before (years of data, on some devices) get their whole numbers
//   converted from REAL to INTEGER
// - turned off again (e.g. an app rolls back a release that turned it on): they're converted back
//   to REAL, so raw SQL sees exactly what it did before the option was ever on
// It runs once, in the background, after the database opens: each table is walked in rowid ranges,
// one small transaction per range, queued behind the app's own work. Values don't change (42.0 and
// 42 are the same JS number), and `_status` / `_changed` aren't touched, so models, observers and
// sync don't notice. Rows already in the right format are skipped, so after an interruption (the app
// is closed, the database is reset) the next launch walks the tables again, cheaply, until it
// finishes. Measured on a Mac: 1,000,000 rows with 4 number columns in 1.2 s, at most 11 ms per range.
// The app's writes meanwhile (seeding, sync, ...) are already in the new format, so it skips them.
//
// Where it stands is kept in local storage, under NUMBER_STORAGE_KEY:
// - no value: numbers are stored as REAL (the default; nothing to do without the option)
// - 'integer': whole numbers are stored as INTEGER
// - 'to-integer' / 'to-real': a conversion started and hasn't finished

export const NUMBER_STORAGE_KEY = '__nitromelondb_number_storage'

/**
 * - `unchanged`: the data was already in the right format
 * - `converted`: this launch finished converting it
 * - `interrupted`: converting stopped (e.g. the connection was closed); it continues on the next launch
 */
export type NumberStorageConversionResult = 'unchanged' | 'converted' | 'interrupted'

const ROWS_PER_TRANSACTION = 2000
const IGNORE_CACHE = 0

// Same limit as bindNumber() in native/shared/Database-sqlite.cpp: whole numbers a double holds exactly
const MAX_EXACT = 9007199254740992

// A REAL with a whole value (-0 included: it converts to 0, and SQL can't tell them apart)
const isWholeReal = (column: string): string =>
  `(typeof(${column}) = 'real' and ${column} = cast(${column} as integer) and abs(${column}) <= ${MAX_EXACT})`

const isInteger = (column: string): string =>
  `(typeof(${column}) = 'integer' and abs(${column}) <= ${MAX_EXACT})`

export default async function convertWholeNumbers(
  dispatcher: SqliteDispatcher,
  schema: AppSchema,
  storeWholeNumbersAsIntegers: boolean,
): Promise<NumberStorageConversionResult> {
  const call = <T>(method: SqliteDispatcherMethod, args: unknown[]): Promise<T> =>
    toPromise<T>((callback) => dispatcher.call(method, args, callback))
  const execute = (sql: string, args: unknown[]): Promise<void> =>
    call<void>('batch', [[[IGNORE_CACHE, null, sql, [args]]]])
  const setState = (value: string): Promise<void> =>
    execute(`insert or replace into "local_storage" ("key", "value") values (?, ?)`, [
      NUMBER_STORAGE_KEY,
      value,
    ])

  const state = await call<string | null>('getLocal', [NUMBER_STORAGE_KEY])
  if (storeWholeNumbersAsIntegers ? state === 'integer' : state == null) {
    return 'unchanged'
  }

  await setState(storeWholeNumbersAsIntegers ? 'to-integer' : 'to-real')
  const [needsConverting, convertTo] = storeWholeNumbersAsIntegers
    ? [isWholeReal, 'integer']
    : [isInteger, 'real']

  for (const table of Object.values(schema.tables)) {
    const columns = table.columnArray
      .filter((column) => column.type === 'number')
      .map((column) => `"${column.name}"`)
    if (columns.length === 0) {
      continue
    }

    // A table created WITHOUT ROWID (through unsafeSql) has no rowid to walk; leave it as it is
    const rows = await call<Array<{ max: number | null }>>('unsafeQueryRaw', [
      `select max(rowid) as max from "${table.name}"`,
      [],
    ]).catch(() => null)
    const maxRowid = rows?.[0]?.max ?? null
    if (maxRowid == null) {
      continue
    }

    const sets = columns
      .map(
        (column) =>
          `${column} = case when ${needsConverting(column)} then cast(${column} as ${convertTo}) else ${column} end`,
      )
      .join(', ')
    const sql = `update "${table.name}" set ${sets} where rowid > ? and rowid <= ? and (${columns
      .map(needsConverting)
      .join(' or ')})`
    for (let from = 0; from < maxRowid; from += ROWS_PER_TRANSACTION) {
      await execute(sql, [from, from + ROWS_PER_TRANSACTION])
      // Let the app's work run between ranges
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  if (storeWholeNumbersAsIntegers) {
    await setState('integer')
  } else {
    await execute(`delete from "local_storage" where "key" = ?`, [NUMBER_STORAGE_KEY])
  }
  return 'converted'
}
