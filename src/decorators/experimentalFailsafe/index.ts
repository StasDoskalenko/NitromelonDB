import { isObj } from '../../utils/fp'
import { catchError, of } from '../../utils/rx'

import type { BabelDescriptor } from '../common'

type Thenable = { catch: (onRejected: (reason: unknown) => unknown) => unknown }
type Pipeable = { pipe: (...ops: unknown[]) => unknown }

type FailsafeValue = {
  fetch?: (...args: unknown[]) => unknown
  observe?: (...args: unknown[]) => unknown
}

function failsafe(fallback?: unknown): PropertyDecorator {
  return (_target: object, key: string | symbol, descriptor?: BabelDescriptor) => {
    const propertyKey = String(key)
    const desc = descriptor || {}

    return {
      ...desc,
      get(): unknown {
        let value: unknown
        const unsafeThis = this as object

        if ('value' in desc) {
          value = desc.value
        } else if ('get' in desc && desc.get) {
          value = desc.get.call(unsafeThis)
        } else if ('initializer' in desc && desc.initializer) {
          value = desc.initializer.call(unsafeThis)
        }

        if (value && isObj(value)) {
          const failsafeValue = value as FailsafeValue
          const originalFetch = failsafeValue.fetch
          const originalObserve = failsafeValue.observe

          if (typeof originalFetch === 'function') {
            failsafeValue.fetch = function fetch(...args: unknown[]): unknown {
              const result = originalFetch.apply(value, args)
              if (isObj(result) && typeof (result as Thenable).catch === 'function') {
                return (result as Thenable).catch(() => fallback)
              }
              return result
            }
          }

          if (typeof originalObserve === 'function') {
            failsafeValue.observe = function observe(...args: unknown[]): unknown {
              const result = originalObserve.apply(value, args)
              if (isObj(result) && typeof (result as Pipeable).pipe === 'function') {
                return (result as Pipeable).pipe(catchError(() => of(fallback)))
              }
              return result
            }
          }
        }

        Object.defineProperty(unsafeThis, propertyKey, {
          value,
          enumerable: desc.enumerable ?? false,
        })

        return value
      },
    }
  }
}

export default failsafe
