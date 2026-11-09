import { logger } from '../../utils/common'
import type { SerializedQuery } from '../../Query'
import type { AppSchema } from '../../Schema'
import type { Where } from '../../QueryDescription'

// Development builds only, with storeWholeNumbersAsIntegers on: warns (once per query) about raw SQL
// whose result can depend on whether a whole number is stored as INTEGER or REAL. With the option,
// `/` between two whole numbers truncates (7 / 2 is 3), and turning one into text gives '42' instead
// of '42.0'. Queries built with Q compare and sort the same either way, except Q.like / Q.includes
// on a number column, which match against that text. It's a heuristic: it can't tell which columns
// raw SQL touches, so it may warn about SQL that's fine.

const DOCS = 'https://stasdoskalenko.github.io/NitromelonDB/docs/Advanced/Performance'

const RISKY_SQL: Array<[RegExp, string]> = [
  [/\//, '`/` is integer division when both sides are whole numbers'],
  [/\|\|/, "`||` turns a whole number into '42', not '42.0'"],
  [/\bcast\s*\([^)]*\bas\s+(text|varchar|char)/i, "casting to text gives '42', not '42.0'"],
  [/\b(printf|format)\s*\(/i, 'formatting a whole number gives a different text'],
  [/\btypeof\s*\(/i, "typeof() returns 'integer' for whole numbers"],
]

const warned = new Set<string>()

function warnOnce(sql: string, why: string): void {
  const key = `${why}\u0000${sql}`
  if (warned.has(key)) return
  warned.add(key)
  logger.warn(
    `[🍉] [storeWholeNumbersAsIntegers] This raw SQL may return something different for numbers stored as INTEGER: ${why}. If it applies to a number column, make the arithmetic a float one (e.g. \`* 1.0\`) or compare numbers instead of text. See ${DOCS}\nSQL: ${sql}`,
  )
}

/** Warns about raw SQL whose result can depend on whole numbers being stored as INTEGER. */
export function warnStorageSensitiveSql(sql: string): void {
  // Ignore comments and string literals, where `/` and `||` mean nothing
  const code = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^']|'')*'/g, "''")
  for (const [pattern, why] of RISKY_SQL) {
    if (pattern.test(code)) {
      warnOnce(sql, why)
      return
    }
  }
}

function checkWhere(conditions: Where[], table: string, schema: AppSchema): void {
  for (const condition of conditions) {
    if (condition.type === 'sql') {
      warnStorageSensitiveSql(condition.expr)
    } else if (condition.type === 'and' || condition.type === 'or') {
      checkWhere(condition.conditions, table, schema)
    } else if (condition.type === 'on') {
      checkWhere(condition.conditions, condition.table, schema)
    } else if (condition.type === 'where') {
      const { operator } = condition.comparison
      if (
        (operator === 'like' || operator === 'notLike' || operator === 'includes') &&
        schema.tables[table]?.columns[condition.left]?.type === 'number'
      ) {
        warnOnce(
          `Q.where('${condition.left}', Q.${operator}(…)) on "${table}"`,
          `Q.${operator} on a number column matches against its text, which is '42' instead of '42.0' for whole numbers`,
        )
      }
    }
  }
}

/** Checks a query's raw SQL parts (Q.unsafeSqlQuery, Q.unsafeSqlExpr) and text matches on numbers. */
export function warnStorageSensitiveQuery(query: SerializedQuery, schema: AppSchema): void {
  const { description, table } = query
  if (description.sql) {
    warnStorageSensitiveSql(description.sql.sql)
  }
  checkWhere(description.where, table, schema)
  for (const sortBy of description.sortBy) {
    if ('sortExpr' in sortBy) {
      warnStorageSensitiveSql(sortBy.sortExpr)
    }
  }
}
