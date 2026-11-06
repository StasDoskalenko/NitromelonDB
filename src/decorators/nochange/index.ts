import makeDecorator from '../../utils/common/makeDecorator'
import invariant from '../../utils/common/invariant'

import { isStandardDecoratorContext, wrapFieldSetter, type ModelDecoratorHost } from '../common'
import type { BareOrCalledDecorator, FieldModifierDecorator } from '../types'

// Marks a model field as immutable after create — you can set and change the value in
// create() and prepareCreate(), but after it's saved to the database, it cannot be changed

const notAModelField = `@nochange can only be applied to model fields (to properties with a setter)`

function guardSetter(
  errorMessage: string,
  originalSet: ((this: unknown, value: unknown) => void) | undefined,
): (this: unknown, value: unknown) => void {
  invariant(originalSet, notAModelField)
  return function set(this: unknown, value: unknown): void {
    invariant((this as ModelDecoratorHost).asModel._preparedState === 'create', errorMessage)
    originalSet.call(this, value)
  }
}

const nochange = makeDecorator(
  () => (target: unknown, keyOrContext: unknown, descriptor?: PropertyDescriptor) => {
    if (isStandardDecoratorContext(keyOrContext)) {
      return wrapFieldSetter('@nochange', keyOrContext, target, (key, set) =>
        guardSetter(`Attempt to set a new value on a @nochange field: ${key}`, set),
      )
    }

    invariant(descriptor && descriptor.set, notAModelField)
    const errorMessage = `Attempt to set a new value on a @nochange field: ${(target as { constructor: { name: string } }).constructor.name}.prototype.${String(keyOrContext)}`

    return {
      ...descriptor,
      set: guardSetter(errorMessage, descriptor.set),
    }
  },
) as BareOrCalledDecorator<FieldModifierDecorator>

export default nochange
