import Query from '../../Query'
import encodeQuery from './encodeQuery'
import type { SQL } from './type'

type QuerySqlPrototype = {
  serialize: () => Parameters<typeof encodeQuery>[0]
  _sql: (count?: boolean) => SQL
}

;(Query.prototype as unknown as QuerySqlPrototype)._sql = function _sql(
  count: boolean = false,
): SQL {
  const [sql] = encodeQuery(this.serialize(), count)
  return sql
}
