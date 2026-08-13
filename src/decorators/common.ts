import invariant from '../utils/common/invariant'

import type { ColumnName } from '../Schema'
import type Model from '../Model'
import type Query from '../Query'
import type Relation from '../Relation'

export type BabelDescriptor = PropertyDescriptor & {
  initializer?: (this: unknown) => unknown
}

export type ModelDecoratorHost = {
  asModel: Model
  _jsonDecoratorCache?: { [field: string]: [unknown, unknown] }
  _childrenQueryCache?: { [table: string]: Query<Model> }
  _relationCache?: { [key: string]: Relation<Model> }
}

export function ensureDecoratorUsedProperly(
  columnName: ColumnName,
  target: object,
  key: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  invariant(
    columnName,
    `Pass column name (raw field name) to the decorator - error in ${(target as { constructor: { name: string } }).constructor.name}.prototype.${key} given.`,
  )
  if (descriptor) {
    invariant(
      'initializer' in descriptor,
      `Model field decorators can only be used for simple properties - method, setter or getter ${(target as { constructor: { name: string } }).constructor.name}.prototype.${key} given.`,
    )
    invariant(
      typeof (descriptor as BabelDescriptor).initializer !== 'function',
      `Model field decorators must not be used on properties with a default value - error in "${(target as { constructor: { name: string } }).constructor.name}.prototype.${key}".`,
    )
  }
}
