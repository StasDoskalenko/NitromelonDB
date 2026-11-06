import makeDecorator from '../../utils/common/makeDecorator'

import { modelFieldDecorator, type ModelDecoratorHost } from '../common'
import type { ModelFieldDecorator } from '../types'

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

const text = makeDecorator((columnName: unknown) => {
  const name = columnName as ColumnName
  return modelFieldDecorator('@text', name, () => ({
    get(this: ModelDecoratorHost): string | null {
      return this.asModel._getRaw(name) as string | null
    },
    set(this: ModelDecoratorHost, value: string | null | undefined): void {
      this.asModel._setRaw(name, typeof value === 'string' ? value.trim() : null)
    },
  }))
}) as (columnName: ColumnName) => ModelFieldDecorator

export default text
