import makeDecorator from '../../utils/common/makeDecorator'
import invariant from '../../utils/common/invariant'

import { isStandardDecoratorContext, wrapFieldSetter } from '../common'
import type { BareOrCalledDecorator, FieldModifierDecorator } from '../types'

// Marks a field as non-writable (throws an error when attempting to set a new value)
// When using multiple decorators, remember to mark as @readonly *last* (leftmost)

const throwingSetter = (message: string) =>
  function set(): void {
    invariant(false, message)
  }

const readonly = makeDecorator(
  () => (target: unknown, keyOrContext: unknown, descriptor?: PropertyDescriptor) => {
    if (isStandardDecoratorContext(keyOrContext)) {
      const context = keyOrContext
      const key = String(context.name)
      const message = `Attempt to set new value on a property ${key} marked as @readonly`

      if (context.kind === 'field') {
        // A model field (another decorator put a getter/setter on the instance) gets a throwing
        // setter; a simple field becomes non-writable, like legacy @readonly does.
        context.addInitializer(function makeReadonly(this: unknown) {
          const own = Object.getOwnPropertyDescriptor(this, key)
          if (own && (own.get || own.set)) {
            Object.defineProperty(this, key, { ...own, set: throwingSetter(message) })
          } else {
            Object.defineProperty(this, key, { ...own, writable: false })
          }
        })
        return undefined
      }
      if (context.kind === 'getter') {
        // A getter without a setter already can't be assigned to
        return undefined
      }
      return wrapFieldSetter('@readonly', context, target, () => throwingSetter(message))
    }

    const legacyDescriptor = descriptor as PropertyDescriptor
    // Set a new setter on getter/setter fields
    if (legacyDescriptor.get || legacyDescriptor.set) {
      return {
        ...legacyDescriptor,
        set: throwingSetter(
          `Attempt to set new value on a property ${(target as { constructor: { name: string } }).constructor.name}.prototype.${String(keyOrContext)} marked as @readonly`,
        ),
      }
    }

    // Mark as writable=false for simple fields
    legacyDescriptor.writable = false
    return legacyDescriptor
  },
) as BareOrCalledDecorator<FieldModifierDecorator>

export default readonly
