import type { LokiQuery, LokiJoin, LokiRawQuery } from '../encodeQuery'
import type { DirtyRaw } from '../../../../RawRecord'

type QueryPerformer = (join: LokiJoin) => DirtyRaw[]

function performJoinsImpl(query: LokiRawQuery, performer: QueryPerformer): LokiRawQuery {
  if (!query) {
    return query
  } else if (query.$join) {
    const join = query.$join as LokiJoin
    const joinQuery = performJoinsImpl(join.query, performer)
    join.query = joinQuery
    const records = performer(join)

    // for queries on `belongs_to` tables, matchingIds will be IDs of the parent table records
    //   (e.g. task: { project_id in ids })
    // and for `has_many` tables, it will be IDs of the main table records
    //   (e.g. task: { id in (ids from tag_assignment.task_id) })
    const matchingIds = records.map((record) => record[join.mapKey])
    return { [join.joinKey]: { $in: matchingIds } }
  } else if (query.$and) {
    const clauses = query.$and as LokiRawQuery[]
    return { $and: clauses.map((clause) => performJoinsImpl(clause, performer)) }
  } else if (query.$or) {
    const clauses = query.$or as LokiRawQuery[]
    return { $or: clauses.map((clause) => performJoinsImpl(clause, performer)) }
  }
  return query
}

export default function performJoins(lokiQuery: LokiQuery, performer: QueryPerformer): LokiRawQuery {
  const { query, hasJoins } = lokiQuery

  if (!hasJoins) {
    return query
  }

  return performJoinsImpl(query, performer)
}
