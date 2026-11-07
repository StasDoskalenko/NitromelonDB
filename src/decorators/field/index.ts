import makeDecorator from '../../utils/common/makeDecorator'

import { type Value } from '../../QueryDescription'
import { type ColumnName } from '../../Schema'

import { modelFieldDecorator, type ModelDecoratorHost } from '../common'
import type { ModelFieldDecorator } from '../types'

// Defines a model property
//
// Returns and sets values as-is, except that `undefined` and missing fields are normalized to `null`
// If you have a more specific propety, use the correct decorator (@boolean, @text, etc.)
//
// Pass the database column name as an argument
//
// Example:
//   @field('some_field') someField
//   @field('some_field') accessor someField (standard decorators)

const field = makeDecorator((columnName: unknown) => {
  const name = columnName as ColumnName
  return modelFieldDecorator('@field', name, () => ({
    get(this: ModelDecoratorHost): Value {
      return this.asModel._getRaw(name)
    },
    set(this: ModelDecoratorHost, value: Value): void {
      this.asModel._setRaw(name, value)
    },
  }))
}) as (columnName: ColumnName) => ModelFieldDecorator

export default field
