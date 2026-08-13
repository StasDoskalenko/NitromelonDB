import makeDecorator from '../../utils/common/makeDecorator'

import { ensureDecoratorUsedProperly, type ModelDecoratorHost } from '../common'

import { type ColumnName } from '../../Schema'

// Defines a model property representing user-input text
//
// On set, all strings are trimmed (whitespace is removed from beginning/end)
// and all non-string values are converted to strings
// (Except null which is passed as-is)
//
// Pass the database column name as an argument
//
// Examples:
//   @text(Column.name) name: string
//   @text('full_description') fullDescription: string

const text = makeDecorator(
  (columnName: unknown) => (target: object, key: string, descriptor: PropertyDescriptor) => {
    const name = columnName as ColumnName
    ensureDecoratorUsedProperly(name, target, key, descriptor)

    return {
      configurable: true,
      enumerable: true,
      get(this: ModelDecoratorHost): string | null {
        return this.asModel._getRaw(name) as string | null
      },
      set(this: ModelDecoratorHost, value: string | null | undefined): void {
        this.asModel._setRaw(name, typeof value === 'string' ? value.trim() : null)
      },
    }
  },
) as (columnName: ColumnName) => PropertyDecorator

export default text
