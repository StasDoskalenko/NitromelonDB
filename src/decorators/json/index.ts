import { type ColumnName } from '../../Schema'
import type Model from '../../Model'

import { ensureDecoratorUsedProperly, type ModelDecoratorHost } from '../common'

// Defines a model property that's (de)serialized to and from JSON using custom sanitizer function.
//
// Pass the database column name as first argument, and sanitizer function as second.
//
// Stored value will be parsed to JSON if possible, and passed to sanitizer as argument, or
// undefined will be passed on parsing error. Field value will be result of sanitizer call.
//
// Value assigned to field will be passed to sanitizer and its results will be stored as stringified
// value.
//
// Examples:
//   @json('contact_info', jsonValue => jasonValue || {}) contactInfo: ContactInfo

export type Sanitizer = (source: unknown, model?: Model) => unknown

export type Options = {
  /** Use cached value if possible rather than sanitizing the raw value for every read. Default: `false` */
  memo: boolean
}

const parseJSON = (value: unknown): unknown => {
  // fast path
  if (value === null || value === undefined || value === '') {
    return undefined
  }
  try {
    return JSON.parse(value as string)
  } catch {
    return undefined
  }
}

const defaultOptions: Options = { memo: false }

export function json(
  rawFieldName: ColumnName,
  sanitizer: Sanitizer,
  options: Options = defaultOptions,
): PropertyDecorator {
  return (target: object, key: string | symbol, descriptor?: PropertyDescriptor) => {
    ensureDecoratorUsedProperly(rawFieldName, target, String(key), descriptor)

    return {
      configurable: true,
      enumerable: true,
      get(this: ModelDecoratorHost): unknown {
        const model = this
        const rawValue = model.asModel._getRaw(rawFieldName)

        if (options.memo) {
          // Use cached value if possible
          model._jsonDecoratorCache = model._jsonDecoratorCache || {}
          const cachedEntry = model._jsonDecoratorCache[rawFieldName]
          if (cachedEntry && cachedEntry[0] === rawValue) {
            return cachedEntry[1]
          }
        }

        const parsedValue = parseJSON(rawValue)
        const sanitized = sanitizer(parsedValue, model as unknown as Model)

        if (options.memo) {
          model._jsonDecoratorCache = model._jsonDecoratorCache || {}
          model._jsonDecoratorCache[rawFieldName] = [rawValue, sanitized]
        }

        return sanitized
      },
      set(this: ModelDecoratorHost, jsonValue: unknown): void {
        const model = this
        const sanitizedValue = sanitizer(jsonValue, model as unknown as Model)
        const stringifiedValue = sanitizedValue != null ? JSON.stringify(sanitizedValue) : null

        model.asModel._setRaw(rawFieldName, stringifiedValue)
      },
    }
  }
}

export const jsonDecorator = json
export default jsonDecorator
