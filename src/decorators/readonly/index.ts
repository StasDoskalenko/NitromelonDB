import makeDecorator from '../../utils/common/makeDecorator'
import invariant from '../../utils/common/invariant'

// Marks a field as non-writable (throws an error when attempting to set a new value)
// When using multiple decorators, remember to mark as @readonly *last* (leftmost)

const readonly = makeDecorator(
  () => (target: object, key: string, descriptor: PropertyDescriptor) => {
    // Set a new setter on getter/setter fields
    if (descriptor.get || descriptor.set) {
      return {
        ...descriptor,
        set(): void {
          invariant(
            false,
            `Attempt to set new value on a property ${(target as { constructor: { name: string } }).constructor.name}.prototype.${key} marked as @readonly`,
          )
        },
      }
    }

    // Mark as writable=false for simple fields
    descriptor.writable = false
    return descriptor
  },
) as {
  (target: object, propertyKey: string | symbol): void
  (): PropertyDecorator
}

export default readonly
