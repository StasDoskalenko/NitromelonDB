import makeDecorator from '../../utils/common/makeDecorator'
import invariant from '../../utils/common/invariant'

import { type ModelDecoratorHost } from '../common'

// Marks a model field as immutable after create — you can set and change the value in
// create() and prepareCreate(), but after it's saved to the database, it cannot be changed

const nochange = makeDecorator(
  () => (target: object, key: string, descriptor: PropertyDescriptor) => {
    invariant(
      descriptor.set,
      `@nochange can only be applied to model fields (to properties with a setter)`,
    )

    const errorMessage = `Attempt to set a new value on a @nochange field: ${(target as { constructor: { name: string } }).constructor.name}.prototype.${key}`
    const originalSet = descriptor.set

    return {
      ...descriptor,
      set(this: ModelDecoratorHost, value: unknown): void {
        invariant(this.asModel._preparedState === 'create', errorMessage)
        originalSet.call(this, value)
      },
    }
  },
) as {
  (target: object, propertyKey: string | symbol): void
  (): PropertyDecorator
}

export default nochange
