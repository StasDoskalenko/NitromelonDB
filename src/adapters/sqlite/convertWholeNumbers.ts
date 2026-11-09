import type { AppSchema } from '../../Schema'
import { toPromise } from '../../utils/fp/Result'
import type { SqliteDispatcher, SqliteDispatcherMethod } from './type'

// With storeWholeNumbersAsIntegers, new writes store whole numbers as INTEGER. This converts the
// rows written before it was turned on (years of data, on some devices), once, in the background:
// each table is walked in rowid ranges, one small transaction per range, queued behind the app's
// own writes. Values don't change (42.0 becomes 42, the same JS number), and `_status` / `_changed`
// aren't touched, so models, observers and sync don't notice. The UPDATE skips rows already
// converted, so after an interruption (the app is closed, the database is reset) the next launch
// just walks the table again, which is cheap, until it finishes and records that it's done.
// Measured on a Mac: 1,000,000 rows with 4 number columns in 1.2 s, at most 11 ms per range.

export const WHOLE_NUMBERS_CONVERTED_KEY = '__nitromelondb_whole_numbers_as_integers'
const ROWS_PER_TRANSACTION = 2000
const IGNORE_CACHE = 0

// A REAL with a whole value that a double holds exactly, like bindNumber() in
// native/shared/Database-sqlite.cpp (except -0, which converts to 0: SQL can't tell them apart)
const isConvertible = (column: string): string =>
  `(typeof(${column}) = 'real' and ${column} = cast(${column} as integer) and abs(${column}) <= 9007199254740992)`

export default async function convertWholeNumbers(
  dispatcher: SqliteDispatcher,
  schema: AppSchema,
): Promise<void> {
  const call = <T>(method: SqliteDispatcherMethod, args: unknown[]): Promise<T> =>
    toPromise<T>((callback) => dispatcher.call(method, args, callback))

  if ((await call<string | null>('getLocal', [WHOLE_NUMBERS_CONVERTED_KEY])) === 'done') {
    return
  }

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
          `${column} = case when ${isConvertible(column)} then cast(${column} as integer) else ${column} end`,
      )
      .join(', ')
    const sql = `update "${table.name}" set ${sets} where rowid > ? and rowid <= ? and (${columns
      .map(isConvertible)
      .join(' or ')})`
    for (let from = 0; from < maxRowid; from += ROWS_PER_TRANSACTION) {
      await call<void>('batch', [
        [[IGNORE_CACHE, null, sql, [[from, from + ROWS_PER_TRANSACTION]]]],
      ])
      // Let the app's work run between ranges
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  await call<void>('batch', [
    [
      [
        IGNORE_CACHE,
        null,
        `insert or replace into "local_storage" ("key", "value") values (?, ?)`,
        [[WHOLE_NUMBERS_CONVERTED_KEY, 'done']],
      ],
    ],
  ])
}
