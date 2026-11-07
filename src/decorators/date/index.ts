import makeDecorator from '../../utils/common/makeDecorator'
import { onLowMemory } from '../../utils/common/memory'
import WeakValueCache from '../../utils/common/WeakValueCache'
import { type ColumnName } from '../../Schema'

import { modelFieldDecorator, type ModelDecoratorHost } from '../common'
import type { ModelFieldDecorator } from '../types'

// Defines a model property representing a date
//
// Serializes dates to milisecond-precision Unix timestamps, and deserializes them to Date objects
// (but passes null values as-is)
//
// Pass the database column name as an argument
//
// Examples:
//   @date('reacted_at') reactedAt: Date

const cache = new WeakValueCache<number, Date>('@date decorator cache')
// prune(), not clear(): only reclaims already-dead entries, never evicts a
// Date still referenced elsewhere.
onLowMemory(() => cache.prune())

const dateDecorator = makeDecorator((columnName: unknown) => {
  const name = columnName as ColumnName
  return modelFieldDecorator('@date', name, () => ({
    get(this: ModelDecoratorHost): Date | null {
      const rawValue = this.asModel._getRaw(name)
      if (typeof rawValue === 'number') {
        const cached = cache.get(rawValue)
        if (cached) {
          return cached
        }
        const date = new Date(rawValue)
        cache.set(rawValue, date)
        return date
      }
      return null
    },
    set(this: ModelDecoratorHost, date: Date | null | undefined): void {
      const rawValue = date ? +new Date(date) : null
      if (rawValue && date) {
        cache.set(rawValue, new Date(date))
      }
      this.asModel._setRaw(name, rawValue)
    },
  }))
}) as (columnName: ColumnName) => ModelFieldDecorator

export default dateDecorator
