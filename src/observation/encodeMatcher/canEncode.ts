import type { QueryDescription, Where } from '../../QueryDescription'

export const forbiddenError =
  "Queries with joins, sortBy, take, skip, lokiTransform, unsafeSqlExpr, unsafeLokiExpr can't be encoded into a matcher"

// Q.unsafeSqlExpr / Q.unsafeLokiExpr can't be evaluated in JS against a raw record, so a query
// that contains one anywhere (including inside Q.and / Q.or) has to be observed by re-fetching
const hasUnencodableCondition = (conditions: Where[]): boolean =>
  conditions.some((condition) => {
    switch (condition.type) {
      case 'sql':
      case 'loki':
        return true
      case 'and':
      case 'or':
      case 'on':
        return hasUnencodableCondition(condition.conditions)
      default:
        return false
    }
  })

export default function canEncodeMatcher(query: QueryDescription): boolean {
  const { joinTables, nestedJoinTables, sortBy, take, skip, lokiTransform, sql, where } = query

  return (
    !joinTables.length &&
    !nestedJoinTables.length &&
    !sortBy.length &&
    !take &&
    !skip &&
    !lokiTransform &&
    !sql &&
    !hasUnencodableCondition(where)
  )
}
