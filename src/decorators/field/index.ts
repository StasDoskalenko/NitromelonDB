import makeDecorator from '../../utils/common/makeDecorator'

import { type Value } from '../../QueryDescription'
import { type ColumnName } from '../../Schema'

import { ensureDecoratorUsedProperly, type ModelDecoratorHost } from '../common'

// Defines a model property
//
// Returns and sets values as-is, except that `undefined` and missing fields are normalized to `null`
// If you have a more specific propety, use the correct decorator (@boolean, @text, etc.)
//
// Pass the database column name as an argument
//
// Example:
//   @field('some_field') someField

const field = makeDecorator(
  (columnName: unknown) => (target: object, key: string, descriptor: PropertyDescriptor) => {
    const name = columnName as ColumnName
    ensureDecoratorUsedProperly(name, target, key, descriptor)

    return {
      configurable: true,
      enumerable: true,
      get(this: ModelDecoratorHost): Value {
        return this.asModel._getRaw(name)
      },
      set(this: ModelDecoratorHost, value: Value): void {
        this.asModel._setRaw(name, value)
      },
    }
  },
) as (columnName: ColumnName) => PropertyDecorator

export default field
