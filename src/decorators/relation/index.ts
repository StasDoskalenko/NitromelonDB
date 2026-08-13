import { ensureDecoratorUsedProperly, type ModelDecoratorHost } from '../common'

import Relation, { type Options } from '../../Relation'
import type Model from '../../Model'
import type { ColumnName, TableName } from '../../Schema'

// Defines a model property that fetches a record with a specific ID
// Returns an mutable Relation object
// - when the fetched record changes
// - when the record ID changes (new record must be fetched)
// - … or emits null whenever record ID is null
//
// If the record ID *can't* change, use `immutableRelation` for efficiency
//
// Property's setter assigns a new record (you pass the record, and the ID is set)
//
// relationIdColumn - name of the column with record ID
// relationTable - name of the table containing desired recods
//
// Example: a Task has a project it belongs to (and the project can change), so it may define:
//   @relation('project', 'project_id') project: Relation<Project>

function relation(
  relationTable: TableName,
  relationIdColumn: ColumnName,
  options?: Options | null,
): PropertyDecorator {
  return (target: object, key: string | symbol, descriptor?: PropertyDescriptor) => {
    const propertyKey = String(key)
    ensureDecoratorUsedProperly(relationIdColumn, target, propertyKey, descriptor)

    return {
      get(this: ModelDecoratorHost): Relation<Model> {
        const model = this
        model._relationCache = model._relationCache || {}
        const cachedRelation = model._relationCache[propertyKey]
        if (cachedRelation) {
          return cachedRelation
        }

        const newRelation = new Relation(
          model.asModel,
          relationTable,
          relationIdColumn,
          options || { isImmutable: false },
        )
        model._relationCache[propertyKey] = newRelation

        return newRelation
      },
      set(): void {
        throw new Error(`Don't set relation directly. Use relation.set() instead`)
      },
    }
  }
}

export default relation
