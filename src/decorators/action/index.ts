import type { Descriptor } from '../../utils/common/makeDecorator'
import deprecated from '../../utils/common/deprecated'
import type Database from '../../Database'

type ActionHost = {
  database: Database
  table?: string
  constructor: { name: string }
}

function wrapInDatabaseMethod(
  method: 'write' | 'read',
  key: string,
  descriptor: Descriptor,
): Descriptor {
  const original = descriptor.value as (this: unknown, ...args: unknown[]) => Promise<unknown>

  return {
    ...descriptor,
    value(this: ActionHost, ...args: unknown[]): Promise<unknown> {
      // Computed here, not eagerly at decoration time: a decorator's `target` is
      // just the bare prototype (no instance exists yet when it runs), and
      // Collection's `table` getter reads `this.modelClass`, an instance field
      // only set by the constructor — reading it off the prototype throws.
      // `this` here is a real, constructed instance, so `this.table` is safe
      // for both Model (reads the static side via `this.constructor`) and
      // Collection (reads `this.modelClass`) subclasses.
      const actionName = `${this.table || this.constructor.name}.${key}`
      return this.database[method](() => original.apply(this, args), actionName)
    },
  }
}

// Wraps function calls in `database.write(() => { ... })`. See docs for more details
// You can use this on Model subclass methods (or methods of any object that has a `database` property)
export function writer(_target: object, key: string, descriptor: Descriptor): Descriptor {
  return wrapInDatabaseMethod('write', key, descriptor)
}

// Wraps function calls in `database.read(() => { ... })`. See docs for more details
// You can use this on Model subclass methods (or methods of any object that has a `database` property)
export function reader(_target: object, key: string, descriptor: Descriptor): Descriptor {
  return wrapInDatabaseMethod('read', key, descriptor)
}

/**
 * @deprecated Use {@link writer} instead.
 */
export default function action(_target: object, key: string, descriptor: Descriptor): Descriptor {
  const original = descriptor.value as (this: unknown, ...args: unknown[]) => Promise<unknown>

  return {
    ...descriptor,
    value(this: ActionHost, ...args: unknown[]): Promise<unknown> {
      if (process.env.NODE_ENV !== 'production') {
        deprecated('@action', 'Use @writer instead.')
      }
      // Lazy for the same reason as in wrapInDatabaseMethod. Goes through write() with the label
      // Database.action() would add, so users see the @action warning, not Database.action()'s.
      const actionName = `${this.table || this.constructor.name}.${key}`
      return this.database.write(() => original.apply(this, args), `${actionName} (legacy action)`)
    },
  }
}
