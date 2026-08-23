import type { Descriptor } from '../../utils/common/makeDecorator'
import type Database from '../../Database'

type ActionHost = {
  database: Database
  table?: string
  constructor: { name: string }
}

function wrapInDatabaseMethod(
  method: 'write' | 'read' | 'action',
  key: string,
  descriptor: Descriptor,
): Descriptor {
  const original = descriptor.value as (this: unknown, ...args: unknown[]) => Promise<unknown>

  return {
    ...descriptor,
    value(this: ActionHost, ...args: unknown[]): Promise<unknown> {
      // Computed here, not eagerly at decoration time: `target` there is just
      // the bare prototype (no instance exists yet when a decorator runs), and
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
export default function action(target: object, key: string, descriptor: Descriptor): Descriptor {
  const actionName = `${(target as ActionHost).table}.${key}`
  const original = descriptor.value as (this: unknown, ...args: unknown[]) => Promise<unknown>

  return {
    ...descriptor,
    value(this: ActionHost, ...args: unknown[]): Promise<unknown> {
      return this.database.action(() => original.apply(this, args), actionName)
    },
  }
}
