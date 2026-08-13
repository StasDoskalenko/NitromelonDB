import makeDecorator from '../../utils/common/makeDecorator'
import logError from '../../utils/common/logError'
import invariant from '../../utils/common/invariant'

import * as Q from '../../QueryDescription'
import type { TableName } from '../../Schema'
import type Model from '../../Model'
import type Query from '../../Query'

import { type ModelDecoratorHost } from '../common'

// Defines a model property that queries records that *belong_to* this model
// Pass name of the table with desired records. (The model defining a @children property must
// have a has_many association defined with this table)
//
// Example: a Task has_many Comments, so it may define:
//   @children('comment') comments: Query<Comment>

const children = makeDecorator(
  (childTable: unknown) => () => ({
    get(this: ModelDecoratorHost): Query<Model> {
      const table = childTable as TableName
      // Use cached Query if possible
      this._childrenQueryCache = this._childrenQueryCache || {}
      const cachedQuery = this._childrenQueryCache[table]
      if (cachedQuery) {
        return cachedQuery
      }

      // Cache new Query
      const model = this.asModel
      const childCollection = model.collections.get(table)

      const association = (model.constructor as typeof Model).associations[table]
      invariant(
        association && association.type === 'has_many',
        `@children decorator used for a table that's not has_many`,
      )

      const query = childCollection.query(Q.where(association.foreignKey, model.id))

      this._childrenQueryCache[table] = query
      return query
    },
    set(): void {
      logError('Setter called on a @children-marked property')
    },
  }),
) as (childTable: TableName) => PropertyDecorator

export default children
