// A minimal "async-local variable": a value that follows a logical async flow -- through `await`s,
// `.then()` chains and helper functions -- instead of the synchronous call stack. Used by the
// WorkQueue to know which running reader/writer a `database.write()` / `read()` call logically
// belongs to (experimentalDetectNestedWriters).
//
// No single primitive exists on every engine NitromelonDB runs on, so this picks the best one
// available, in order:
//
// 1. `AsyncContext.Variable` (TC39 proposal) -- if the engine (or a polyfill) provides it.
// 2. Node's `AsyncLocalStorage` (Node, Jest, Electron main, Bun, Deno) -- reached through
//    `process.getBuiltinModule()` so bundlers never see a `node:async_hooks` import.
// 3. `promise-then` -- Zone.js-style propagation through `Promise.prototype.then`, for Hermes
//    and browsers. Callbacks passed to `.then()` while a value is set are wrapped so they run
//    with that value set again. This covers `await` whenever it's compiled to `.then()` -- which
//    on React Native is always the case today (Babel's async-to-generator transform turns every
//    `await x` into `Promise.resolve(x).then(next, throw)`), as are this library's own builds.
//    It does NOT see a natively-executed `await` (V8/JSC/SpiderMonkey, or Hermes with native
//    async enabled): the engine resumes the function without calling `.then()`. It also doesn't
//    follow timers or event callbacks -- only promise continuations.
//
// Tier 3 replaces `Promise.prototype.then` globally, so it's only installed when a variable is
// actually created in that tier (i.e. only when experimentalDetectNestedWriters is on), and adds
// one function call per `.then()` while no value is set.

export type AsyncContextKind = 'AsyncContext' | 'AsyncLocalStorage' | 'promise-then'

export interface AsyncVariable<T> {
  readonly kind: AsyncContextKind
  /** Runs `fn` with the variable set to `value` (`undefined` = unset) for everything it starts. */
  run<R>(value: T | undefined, fn: () => R): R
  get(): T | undefined
}

type ThenCallback = ((value: unknown) => unknown) | null | undefined

type PromiseThenState = {
  // Current value of every promise-then variable, keyed by variable. Replaced (never mutated)
  // on every change, so a captured mapping is a stable snapshot. `undefined` = nothing set.
  mapping: Map<object, unknown> | undefined
  installedOn: object | undefined
}

// Shared across copies of this module (e.g. two copies of the library in one bundle) so they
// don't double-patch `.then()` or keep separate, inconsistent mappings.
const STATE_KEY = Symbol.for('nitromelondb.asyncContext.promiseThen')

function getPromiseThenState(): PromiseThenState {
  const global = globalThis as unknown as Record<symbol, PromiseThenState | undefined>
  let state = global[STATE_KEY]
  if (!state) {
    state = { mapping: undefined, installedOn: undefined }
    global[STATE_KEY] = state
  }
  return state
}

function wrapCallback(
  state: PromiseThenState,
  captured: Map<object, unknown>,
  callback: ThenCallback,
): ThenCallback {
  if (typeof callback !== 'function') {
    return callback
  }
  return function (this: unknown, value: unknown) {
    const previous = state.mapping
    state.mapping = captured
    try {
      const result = callback.call(this, value)
      if (result instanceof Promise) {
        // The engine adopts a returned promise by reading its `then` -- but only after we've
        // returned and restored the mapping. Read it here too, so a `then` getter that cares
        // which flow is subscribing (WorkQueue#_guardNested) sees the right one.
        Reflect.get(result, 'then')
      }
      return result
    } finally {
      state.mapping = previous
    }
  }
}

function installPromiseThen(state: PromiseThenState): void {
  const proto = Promise.prototype
  if (state.installedOn === proto) {
    return
  }
  const originalThen = proto.then
  // Plain assignment keeps the property's existing (non-enumerable) attributes
  proto.then = function then(
    this: Promise<unknown>,
    onFulfilled?: ThenCallback,
    onRejected?: ThenCallback,
  ) {
    const captured = state.mapping
    if (captured === undefined) {
      return originalThen.call(this, onFulfilled, onRejected)
    }
    return originalThen.call(
      this,
      wrapCallback(state, captured, onFulfilled),
      wrapCallback(state, captured, onRejected),
    )
  } as typeof proto.then
  state.installedOn = proto
}

function createPromiseThenVariable<T>(): AsyncVariable<T> {
  const state = getPromiseThenState()
  installPromiseThen(state)
  const key = {}
  return {
    kind: 'promise-then',
    run<R>(value: T | undefined, fn: () => R): R {
      const previous = state.mapping
      const next = new Map(previous)
      if (value === undefined) {
        next.delete(key)
      } else {
        next.set(key, value)
      }
      state.mapping = next.size ? next : undefined
      try {
        return fn()
      } finally {
        state.mapping = previous
      }
    },
    get(): T | undefined {
      return state.mapping?.get(key) as T | undefined
    },
  }
}

type AsyncContextVariableLike<T> = { run<R>(value: T | undefined, fn: () => R): R; get(): T }
type AsyncLocalStorageLike<T> = { run<R>(store: T, fn: () => R): R; getStore(): T | undefined }

// Engine/runtime globals this file probes for. None are guaranteed to exist.
const engineGlobals = globalThis as {
  AsyncContext?: { Variable?: new <T>() => AsyncContextVariableLike<T> }
  process?: {
    getBuiltinModule?: (
      id: string,
    ) => { AsyncLocalStorage?: new <T>() => AsyncLocalStorageLike<T> } | undefined
  }
}

function createNativeAsyncContextVariable<T>(): AsyncVariable<T> | null {
  const Variable = engineGlobals.AsyncContext?.Variable
  if (typeof Variable !== 'function') {
    return null
  }
  const variable = new Variable<T | undefined>()
  return {
    kind: 'AsyncContext',
    run: (value, fn) => variable.run(value, fn),
    get: () => variable.get(),
  }
}

function createAsyncLocalStorageVariable<T>(): AsyncVariable<T> | null {
  try {
    const proc = engineGlobals.process
    if (!proc || typeof proc.getBuiltinModule !== 'function') {
      return null
    }
    const AsyncLocalStorage = proc.getBuiltinModule('node:async_hooks')?.AsyncLocalStorage
    if (typeof AsyncLocalStorage !== 'function') {
      return null
    }
    const storage = new AsyncLocalStorage<T | undefined>()
    return {
      kind: 'AsyncLocalStorage',
      run: (value, fn) => storage.run(value, fn),
      get: () => storage.getStore(),
    }
  } catch {
    return null
  }
}

/**
 * Creates an async-local variable using the best mechanism available on this engine (see top of
 * file). Pass `kind` to force a specific one (tests); returns null if it's unavailable.
 */
export function createAsyncVariable<T>(kind?: AsyncContextKind): AsyncVariable<T> | null {
  switch (kind) {
    case 'AsyncContext':
      return createNativeAsyncContextVariable()
    case 'AsyncLocalStorage':
      return createAsyncLocalStorageVariable()
    case 'promise-then':
      return createPromiseThenVariable()
    default:
      return (
        createNativeAsyncContextVariable<T>() ||
        createAsyncLocalStorageVariable<T>() ||
        createPromiseThenVariable<T>()
      )
  }
}
