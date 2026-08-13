import type { Descriptor } from '../../utils/common/makeDecorator'
import type Database from '../../Database'

type ActionHost = {
  database: Database
  table?: string
  constructor: { name: string }
}

function wrapInDatabaseMethod(
  method: 'write' | 'read' | 'action',
  target: object,
  key: string,
  descriptor: Descriptor,
): Descriptor {
  const hostTarget = target as ActionHost
  const actionName = `${hostTarget.table || hostTarget.constructor.name}.${key}`
  const original = descriptor.value as (this: unknown, ...args: unknown[]) => Promise<unknown>

  return {
    ...descriptor,
    value(this: ActionHost, ...args: unknown[]): Promise<unknown> {
      return this.database[method](() => original.apply(this, args), actionName)
    },
  }
}

// Wraps function calls in `database.write(() => { ... })`. See docs for more details
// You can use this on Model subclass methods (or methods of any object that has a `database` property)
export function writer(target: object, key: string, descriptor: Descriptor): Descriptor {
  return wrapInDatabaseMethod('write', target, key, descriptor)
}

// Wraps function calls in `database.read(() => { ... })`. See docs for more details
// You can use this on Model subclass methods (or methods of any object that has a `database` property)
export function reader(target: object, key: string, descriptor: Descriptor): Descriptor {
  return wrapInDatabaseMethod('read', target, key, descriptor)
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
