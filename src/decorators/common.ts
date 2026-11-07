import invariant from '../utils/common/invariant'
import logger from '../utils/common/logger'
import {
  isStandardDecoratorContext,
  type StandardDecoratorContext,
} from '../utils/common/makeDecorator'

import type { ColumnName } from '../Schema'
import type Model from '../Model'
import type Query from '../Query'
import type Relation from '../Relation'

export type BabelDescriptor = PropertyDescriptor & {
  initializer?: (this: unknown) => unknown
}

export type ModelDecoratorHost = {
  asModel: Model
  _jsonDecoratorCache?: { [field: string]: [unknown, unknown] }
  _childrenQueryCache?: { [table: string]: Query<Model> }
  _relationCache?: { [key: string]: Relation<Model> }
}

export { isStandardDecoratorContext, type StandardDecoratorContext }

export type FieldAccessors = {
  get(this: ModelDecoratorHost): unknown
  set(this: ModelDecoratorHost, value: never): void
}

type StandardAccessorTarget = {
  get(this: unknown): unknown
  set(this: unknown, value: unknown): void
}

const isDev = process.env.NODE_ENV !== 'production'

export function ensureDecoratorUsedProperly(
  columnName: ColumnName,
  target: object,
  key: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  invariant(
    columnName,
    `Pass column name (raw field name) to the decorator - error in ${(target as { constructor: { name: string } }).constructor.name}.prototype.${key} given.`,
  )
  if (descriptor) {
    invariant(
      'initializer' in descriptor,
      `Model field decorators can only be used for simple properties - method, setter or getter ${(target as { constructor: { name: string } }).constructor.name}.prototype.${key} given.`,
    )
    invariant(
      typeof (descriptor as BabelDescriptor).initializer !== 'function',
      `Model field decorators must not be used on properties with a default value - error in "${(target as { constructor: { name: string } }).constructor.name}.prototype.${key}".`,
    )
  }
}

// Standard decorators run before any instance exists and don't see the class, so errors name the
// property only. Checks that need a value (a default value) happen when an instance is built.
function ensureStandardDecoratorUsedProperly(
  decoratorName: string,
  columnName: ColumnName | null,
  context: StandardDecoratorContext,
): void {
  const key = String(context.name)
  if (columnName !== null) {
    invariant(
      columnName,
      `Pass column name (raw field name) to the decorator - error in ${decoratorName} on "${key}".`,
    )
  }
  invariant(
    context.kind === 'field' || context.kind === 'accessor',
    `Model field decorators can only be used for simple properties - ${context.kind} "${key}" given.`,
  )
  invariant(
    !context.static,
    `Model field decorators can't be used on static properties - "${key}" given.`,
  )
  invariant(
    !context.private,
    `Model field decorators can't be used on private (#) properties - "${key}" given.`,
  )
}

function noDefaultValue(key: string): (initialValue: unknown) => unknown {
  return (initialValue) => {
    invariant(
      initialValue === undefined,
      `Model field decorators must not be used on properties with a default value - error in "${key}".`,
    )
    return initialValue
  }
}

const warned = new Set<string>()

// Dev-only hints about standard-decorator usage that works but has a better form. Once per
// decorator and property name, so a big app isn't flooded.
export function warnOnce(decoratorName: string, key: string, message: string): void {
  const id = `${decoratorName}:${key}`
  if (!warned.has(id)) {
    warned.add(id)
    logger.warn(`${decoratorName} on "${key}": ${message} See "Decorators" in the docs.`)
  }
}

// Runs a model field decorator (@field, @text, @date, @json, @relation, @children) under either
// decorators proposal:
//
// - legacy (Babel's `legacy: true`): returns a getter/setter descriptor for the prototype.
// - standard, on `accessor amount`: returns the getter/setter that replaces the accessor's own
//   storage, which stays unused (all values live in the raw record).
// - standard, on a plain field (`amount!: number`), the fallback that keeps existing models
//   working while they're migrated: standard field decorators can't touch the prototype, so the
//   getter/setter is defined on each instance right after the field is. That costs one
//   Object.defineProperty per field per record, hence the dev warning.
export function modelFieldDecorator(
  decoratorName: string,
  columnName: ColumnName | null,
  makeAccessors: (key: string) => FieldAccessors,
  legacyFlags: { configurable?: boolean; enumerable?: boolean } = {
    configurable: true,
    enumerable: true,
  },
): (target: unknown, keyOrContext: unknown, descriptor?: PropertyDescriptor) => unknown {
  return (target, keyOrContext, descriptor) => {
    if (isStandardDecoratorContext(keyOrContext)) {
      const context = keyOrContext
      ensureStandardDecoratorUsedProperly(decoratorName, columnName, context)
      const key = String(context.name)
      const accessors = makeAccessors(key)

      if (context.kind === 'accessor') {
        return isDev ? { ...accessors, init: noDefaultValue(key) } : accessors
      }

      if (isDev) {
        warnOnce(
          decoratorName,
          key,
          `with standard decorators, declare it as \`accessor ${key}\`. As a plain field it still works, but each record sets it up when it's created, which is slower.`,
        )
      }
      context.addInitializer(function addFieldAccessors(this: unknown) {
        Object.defineProperty(this, key, { configurable: true, enumerable: true, ...accessors })
      })
      return isDev ? noDefaultValue(key) : undefined
    }

    const key = String(keyOrContext)
    if (columnName !== null) {
      ensureDecoratorUsedProperly(columnName, target as object, key, descriptor)
    }
    if (isDev) {
      registerLegacyField(target as object, key, decoratorName, descriptor === undefined)
    }
    return { ...legacyFlags, ...makeAccessors(key) }
  }
}

// Legacy field decorators put a getter/setter on the prototype. If the build then also defines
// the field on each instance (an own data property), that property hides the getter: reads
// return undefined and writes never reach the database, with no error. This happens with
// TypeScript or esbuild when `useDefineForClassFields` is on (the default for ES2022+ targets),
// or with a Babel setup that compiles class fields without letting the decorators replace them.
// In development, the first record of each class is checked for it (checkDecoratedFields).
type LegacyField = { decoratorName: string; compiledByTypeScript: boolean }
const legacyFields = new WeakMap<object, Map<string, LegacyField>>()
const checkedClasses = new WeakSet<object>()

function registerLegacyField(
  prototype: object,
  key: string,
  decoratorName: string,
  // Babel's legacy decorators pass a descriptor; TypeScript's and esbuild's pass none
  compiledByTypeScript: boolean,
): void {
  let fields = legacyFields.get(prototype)
  if (!fields) {
    fields = new Map()
    legacyFields.set(prototype, fields)
  }
  fields.set(key, { decoratorName, compiledByTypeScript })
}

export function checkDecoratedFields(record: object): void {
  if (!isDev || checkedClasses.has(record.constructor)) {
    return
  }
  checkedClasses.add(record.constructor)

  const hidden: string[] = []
  let compiledByTypeScript = false
  for (
    let prototype = Object.getPrototypeOf(record);
    prototype && prototype !== Object.prototype;
    prototype = Object.getPrototypeOf(prototype)
  ) {
    legacyFields.get(prototype)?.forEach((field, key) => {
      const own = Object.getOwnPropertyDescriptor(record, key)
      if (own && 'value' in own) {
        hidden.push(`${key} (${field.decoratorName})`)
        compiledByTypeScript = compiledByTypeScript || field.compiledByTypeScript
      }
    })
  }
  if (!hidden.length) {
    return
  }

  const fix = compiledByTypeScript
    ? 'TypeScript or esbuild defines class fields on each instance (`useDefineForClassFields`, the default for ES2022 and newer targets). Set `"useDefineForClassFields": false` in tsconfig.json.'
    : 'Babel compiled these class fields without letting the decorators replace them. Use the Babel setup from the Installation guide (on Expo, no decorators plugin of your own).'
  logger.error(
    `${record.constructor.name}: decorators aren't working for ${hidden.join(', ')}. Each record has its own plain property with that name, which hides the decorator, so reading it returns undefined and writing it doesn't change the database. ${fix} See "Decorators" in the docs.`,
  )
}

// Wraps the setter of a field another decorator already set up (@nochange, @readonly).
// `wrap` gets the inner setter (undefined if there is none) and returns the new one.
export function wrapFieldSetter(
  decoratorName: string,
  context: StandardDecoratorContext,
  value: unknown,
  wrap: (
    key: string,
    set: ((this: unknown, value: unknown) => void) | undefined,
  ) => (this: unknown, value: unknown) => void,
): unknown {
  const key = String(context.name)
  switch (context.kind) {
    case 'accessor': {
      const target = value as StandardAccessorTarget
      return { get: target.get, set: wrap(key, target.set) }
    }
    case 'setter':
      return wrap(key, value as (this: unknown, value: unknown) => void)
    case 'field':
      // The inner decorator's initializer (decorators apply innermost first) has already put a
      // getter/setter on the instance by the time this one runs.
      context.addInitializer(function wrapSetter(this: unknown) {
        const own = Object.getOwnPropertyDescriptor(this, key)
        const wrapped: PropertyDescriptor = {
          configurable: true,
          enumerable: own?.enumerable ?? true,
          set: wrap(key, own?.set),
        }
        if (own?.get) {
          wrapped.get = own.get
        }
        Object.defineProperty(this, key, wrapped)
      })
      return undefined
    default:
      invariant(false, `${decoratorName} can't be used on a ${context.kind} ("${key}").`)
      return undefined
  }
}
