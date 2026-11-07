import { isStandardDecoratorContext, warnOnce, type BabelDescriptor } from '../common'
import type { LazyDecorator } from '../types'

// Defines a property whose value is evaluated the first time it is accessed
// For example:
//
// class X {
//   @lazy date = new Date()
//   @lazy get otherDate() { return new Date() } // getter form, also works with standard decorators
// }
//
// `date` will be set to the current date not when constructed, but only when `xx.date` is called.
// All subsequent calls will return the same value

// Replaces the prototype getter with the computed value on the instance, so later reads skip it
function cacheOnInstance(
  that: object,
  key: string | symbol,
  value: unknown,
  configurable: boolean,
  enumerable: boolean,
): unknown {
  Object.defineProperty(that, key, { configurable, enumerable, writable: true, value })
  return value
}

// A prototype owns `constructor`; instances (normally) don't. Reading a lazy property straight off
// the prototype must not cache the value there.
const isPrototype = (that: object): boolean =>
  Object.prototype.hasOwnProperty.call(that, 'constructor')

function lazy(target: unknown, keyOrContext: unknown, descriptor?: BabelDescriptor): unknown {
  if (isStandardDecoratorContext(keyOrContext)) {
    const context = keyOrContext
    const key = context.name
    if (context.kind === 'getter') {
      const compute = target as (this: unknown) => unknown
      return function get(this: object): unknown {
        if (isPrototype(this)) {
          return undefined
        }
        return cacheOnInstance(this, key, compute.call(this), true, true)
      }
    }
    // Standard decorators run a field's initializer while the instance is built, before the
    // decorator could defer it, so the value is computed eagerly. It's still computed once.
    if (process.env.NODE_ENV !== 'production') {
      warnOnce(
        '@lazy',
        String(key),
        `with standard decorators, a field's value is computed when the record is created, not on first read. For a lazy value, use a getter: \`@lazy get ${String(key)}() { ... }\`.`,
      )
    }
    return undefined
  }

  const key = keyOrContext as string | symbol
  const { configurable, enumerable, initializer, value, get } = descriptor as BabelDescriptor
  const isConfigurable = configurable ?? true
  const isEnumerable = enumerable ?? true
  return {
    configurable: isConfigurable,
    enumerable: isEnumerable,
    get(): unknown {
      const that = this as object
      // This happens if someone accesses the
      // property directly on the prototype
      if (that === target) {
        return undefined
      }

      let returnValue: unknown
      if (get) {
        returnValue = get.call(that)
      } else {
        returnValue = initializer ? initializer.call(that) : value
      }

      // Next time this property is called, skip the decorator, and just return the precomputed value
      return cacheOnInstance(that, key, returnValue, isConfigurable, isEnumerable)
    },
    // TODO: What should be the behavior on set?
  }
}

const lazyDecorator = lazy as unknown as LazyDecorator & (() => LazyDecorator)

export default lazyDecorator

// Implementation inspired by lazyInitialize from `core-decorators`
