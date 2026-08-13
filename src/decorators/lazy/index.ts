import type { BabelDescriptor } from '../common'

// Defines a property whose value is evaluated the first time it is accessed
// For example:
//
// class X {
//   @lazy date = new Date()
// }
//
// `date` will be set to the current date not when constructed, but only when `xx.date` is called.
// All subsequent calls will return the same value

function lazy(
  target: object,
  key: string,
  descriptor: BabelDescriptor,
): BabelDescriptor {
  const { configurable, enumerable, initializer, value } = descriptor
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

      const returnValue = initializer ? initializer.call(that) : value

      // Next time this property is called, skip the decorator, and just return the precomputed value
      Object.defineProperty(that, key, {
        configurable: isConfigurable,
        enumerable: isEnumerable,
        writable: true,
        value: returnValue,
      })

      return returnValue
    },
    // TODO: What should be the behavior on set?
  }
}

// experimentalDecorators call property decorators with 2 arguments; Babel still passes the descriptor.
const lazyDecorator = lazy as unknown as {
  (target: object, propertyKey: string | symbol): void
  (): PropertyDecorator
}

export default lazyDecorator

// Implementation inspired by lazyInitialize from `core-decorators`
