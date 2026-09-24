import type { QueryDescription, Where } from '../../QueryDescription'

export const forbiddenError =
  "Queries with joins, sortBy, take, skip, lokiTransform, unsafeSqlExpr, unsafeLokiExpr can't be encoded into a matcher"

// Mirrors encodeWhere() in ./index: only plain `where` comparisons, and `and`/`or` made entirely
// of them, can be evaluated in JS against a raw record. Anything else -- Q.unsafeSqlExpr,
// Q.unsafeLokiExpr, a Q.on nested in Q.and/Q.or, or any clause type added later -- means the query
// has to be observed by re-fetching instead. (An allow-list, following Nozbe/WatermelonDB#1977.)
const isEncodableWhere = (condition: Where): boolean => {
  switch (condition.type) {
    case 'where':
      return true
    case 'and':
    case 'or':
      return condition.conditions.every(isEncodableWhere)
    default:
      return false
  }
}

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
    where.every(isEncodableWhere)
  )
}
