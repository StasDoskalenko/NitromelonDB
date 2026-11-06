import type { Descriptor } from '../../utils/common/makeDecorator'
import deprecated from '../../utils/common/deprecated'
import invariant from '../../utils/common/invariant'
import type Database from '../../Database'

import { isStandardDecoratorContext } from '../common'
import type { ModelMethodDecorator } from '../types'

type ActionHost = {
  database: Database
  table?: string
  constructor: { name: string }
}

type Method = (this: unknown, ...args: unknown[]) => Promise<unknown>

// Legacy decorators pass (prototype, key, descriptor) and expect a descriptor back; standard ones
// pass (method, context) and expect the replacement method.
function decorateMethod(
  decoratorName: string,
  target: unknown,
  keyOrContext: unknown,
  descriptor: Descriptor | undefined,
  wrap: (original: Method, key: string) => Method,
): unknown {
  if (isStandardDecoratorContext(keyOrContext)) {
    invariant(
      keyOrContext.kind === 'method',
      `${decoratorName} can only be used on methods - ${keyOrContext.kind} "${String(keyOrContext.name)}" given.`,
    )
    return wrap(target as Method, String(keyOrContext.name))
  }
  const legacyDescriptor = descriptor as Descriptor
  return {
    ...legacyDescriptor,
    value: wrap(legacyDescriptor.value as Method, String(keyOrContext)),
  }
}

function wrapInDatabaseMethod(method: 'write' | 'read'): (original: Method, key: string) => Method {
  return (original, key) =>
    function wrapped(this: ActionHost, ...args: unknown[]): Promise<unknown> {
      // Computed here, not eagerly at decoration time: a decorator's `target` is
      // just the bare prototype (no instance exists yet when it runs), and
      // Collection's `table` getter reads `this.modelClass`, an instance field
      // only set by the constructor — reading it off the prototype throws.
      // `this` here is a real, constructed instance, so `this.table` is safe
      // for both Model (reads the static side via `this.constructor`) and
      // Collection (reads `this.modelClass`) subclasses.
      const actionName = `${this.table || this.constructor.name}.${key}`
      return this.database[method](() => original.apply(this, args), actionName)
    } as Method
}

const wrapInWriter = wrapInDatabaseMethod('write')
const wrapInReader = wrapInDatabaseMethod('read')

// Wraps function calls in `database.write(() => { ... })`. See docs for more details
// You can use this on Model subclass methods (or methods of any object that has a `database` property)
export const writer = ((target: unknown, keyOrContext: unknown, descriptor?: Descriptor) =>
  decorateMethod('@writer', target, keyOrContext, descriptor, wrapInWriter)) as ModelMethodDecorator

// Wraps function calls in `database.read(() => { ... })`. See docs for more details
// You can use this on Model subclass methods (or methods of any object that has a `database` property)
export const reader = ((target: unknown, keyOrContext: unknown, descriptor?: Descriptor) =>
  decorateMethod('@reader', target, keyOrContext, descriptor, wrapInReader)) as ModelMethodDecorator

const wrapInLegacyAction = (original: Method, key: string): Method =>
  function wrapped(this: ActionHost, ...args: unknown[]): Promise<unknown> {
    if (process.env.NODE_ENV !== 'production') {
      deprecated('@action', 'Use @writer instead.')
    }
    // Lazy for the same reason as in wrapInDatabaseMethod. Goes through write() with the label
    // Database.action() would add, so users see the @action warning, not Database.action()'s.
    const actionName = `${this.table || this.constructor.name}.${key}`
    return this.database.write(() => original.apply(this, args), `${actionName} (legacy action)`)
  } as Method

/**
 * @deprecated Use {@link writer} instead.
 */
const action = ((target: unknown, keyOrContext: unknown, descriptor?: Descriptor) =>
  decorateMethod(
    '@action',
    target,
    keyOrContext,
    descriptor,
    wrapInLegacyAction,
  )) as ModelMethodDecorator

export default action
