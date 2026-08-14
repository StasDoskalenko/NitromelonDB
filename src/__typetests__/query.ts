import { Q, type Collection, type ColumnName, type Model, type TableName } from '../index'

const collection = null as unknown as Collection<Model>
const t = null as unknown as TableName
const c = null as unknown as ColumnName

// Check that queries don't break
collection.query()
collection.query(Q.where(c, true))
collection.query(Q.and(Q.where(c, true)))
collection.query(Q.or(Q.where(c, true)))
collection.query(Q.on(t, Q.where(c, true)))
collection.query().extend(Q.where(c, true))

// Same as above, but as an array
collection.query([])
collection.query([Q.where(c, true)])
collection.query(Q.and([Q.where(c, true)]))
collection.query(Q.or([Q.where(c, true)]))
collection.query(Q.on(t, [Q.where(c, true)]))
collection.query().extend([Q.where(c, true)])
