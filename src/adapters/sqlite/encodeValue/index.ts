import { logError } from '../../../utils/common'

// Note: SQLite doesn't support literal TRUE and FALSE; expects 1 or 0 instead
// It also doesn't encode strings the same way
// Also: catches invalid values (undefined, NaN) early

// Standard SQL string literal: single-quoted, embedded quotes doubled. SQLite has
// no backslash escapes (https://sqlite.org/lang_expr.html), so nothing else needs escaping.
function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export default function encodeValue(value: unknown): string {
  if (value === true) {
    return '1'
  } else if (value === false) {
    return '0'
  } else if (Number.isNaN(value)) {
    logError('Passed NaN to query')
    return 'null'
  } else if (value === undefined) {
    logError('Passed undefined to query')
    return 'null'
  } else if (value === null) {
    return 'null'
  } else if (typeof value === 'number') {
    return `${value}`
  } else if (typeof value === 'string') {
    // TODO: We shouldn't ever encode SQL values directly — use placeholders
    return quoteString(value)
  }
  throw new Error('Invalid value to encode into query')
}
