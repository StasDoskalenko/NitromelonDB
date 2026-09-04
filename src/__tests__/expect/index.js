// Minimal Jest-compatible `expect` for the React Native integration-test bundle
// (src/index.integrationTests.native.js). That bundle runs inside an example app,
// not under Jest, so it needs a standalone assertion function on `global.expect`.
//
// Historically this was `npm:expect@24.1.0` aliased as `@nozbe/watermelondb_expect`.
// That dragged an unmaintained 2019 dependency subtree (jest-matcher-utils@24 ->
// jest-diff -> pretty-format -> ansi-regex@4) into the repo. Modern `expect@29+`
// pulls `graceful-fs` (`require('fs')`), which does not bundle cleanly for RN.
//
// The integration suite uses a small, stable slice of the matcher API. This file
// implements exactly that slice and nothing else. It is never published: the npm
// build (scripts/source-files.mjs, DO_NOT_BUILD_PATHS) excludes everything under
// `__tests__/`.
//
// Supported:
//   matchers   toBe toEqual toHaveLength toBeNull toBeTruthy toBeInstanceOf
//              toBeGreaterThan toBeGreaterThanOrEqual toContain toMatch
//              toMatchObject toThrow
//   modifiers  .not  .rejects
//   asymmetric expect.arrayContaining  expect.stringMatching
//
// If a test needs something not listed here, add it here rather than reaching for
// a third-party assertion library.

const NO_ERROR = Symbol('no-error')

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function stringify(value) {
  try {
    if (typeof value === 'function') return value.name ? `[Function ${value.name}]` : '[Function]'
    if (typeof value === 'undefined') return 'undefined'
    const json = JSON.stringify(value)
    if (json === undefined) return String(value)
    return json.length > 200 ? `${json.slice(0, 200)}…` : json
  } catch (_e) {
    return String(value)
  }
}

const isAsymmetric = (value) => value != null && typeof value.asymmetricMatch === 'function'

class ArrayContaining {
  constructor(sample) {
    this.sample = sample
  }

  asymmetricMatch(other) {
    return (
      Array.isArray(this.sample) &&
      Array.isArray(other) &&
      this.sample.every((item) => other.some((candidate) => equals(candidate, item)))
    )
  }

  toString() {
    return `ArrayContaining(${stringify(this.sample)})`
  }
}

class StringMatching {
  constructor(sample) {
    this.regex = typeof sample === 'string' ? new RegExp(escapeRegExp(sample)) : sample
  }

  asymmetricMatch(other) {
    return typeof other === 'string' && this.regex.test(other)
  }

  toString() {
    return `StringMatching(${this.regex})`
  }
}

// Structural equality, matching Jest's `toEqual`: `undefined`-valued own
// properties are ignored, RegExp/Date compared by value, asymmetric matchers
// delegated to.
function equals(a, b) {
  if (isAsymmetric(b)) return b.asymmetricMatch(a)
  if (isAsymmetric(a)) return a.asymmetricMatch(b)
  if (Object.is(a, b)) return true
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.source === b.source && a.flags === b.flags
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false

  const keysA = Object.keys(a).filter((key) => a[key] !== undefined)
  const keysB = Object.keys(b).filter((key) => b[key] !== undefined)
  if (keysA.length !== keysB.length) return false
  return keysA.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key) && equals(a[key], b[key]),
  )
}

// Recursive subset match for `toMatchObject`: every key in `expected` must be
// present and matching in `received`; extra keys in `received` are fine.
function matchesObject(received, expected) {
  if (isAsymmetric(expected)) return expected.asymmetricMatch(received)
  if (expected === null || typeof expected !== 'object') return equals(received, expected)
  if (received === null || typeof received !== 'object') return false
  return Object.keys(expected).every((key) => {
    const expectedValue = expected[key]
    const receivedValue = received[key]
    if (isAsymmetric(expectedValue)) return expectedValue.asymmetricMatch(receivedValue)
    if (expectedValue !== null && typeof expectedValue === 'object') {
      return matchesObject(receivedValue, expectedValue)
    }
    return equals(receivedValue, expectedValue)
  })
}

function errorMatches(error, expected) {
  if (expected === undefined) return true
  const message = error && error.message != null ? String(error.message) : String(error)
  if (typeof expected === 'string') return message.includes(expected)
  if (expected instanceof RegExp) return expected.test(message)
  if (typeof expected === 'function') return error instanceof expected
  if (expected instanceof Error) return message === expected.message
  return false
}

const MATCHERS = {
  toBe: (received, expected) => ({
    pass: Object.is(received, expected),
    message: () => `expected ${stringify(received)} to be ${stringify(expected)}`,
  }),
  toEqual: (received, expected) => ({
    pass: equals(received, expected),
    message: () => `expected ${stringify(received)} to equal ${stringify(expected)}`,
  }),
  toHaveLength: (received, length) => ({
    pass: received != null && received.length === length,
    message: () =>
      `expected value with length ${received == null ? '<none>' : received.length} to have length ${length}`,
  }),
  toBeNull: (received) => ({
    pass: received === null,
    message: () => `expected ${stringify(received)} to be null`,
  }),
  toBeTruthy: (received) => ({
    pass: Boolean(received),
    message: () => `expected ${stringify(received)} to be truthy`,
  }),
  toBeInstanceOf: (received, ctor) => ({
    pass: received instanceof ctor,
    message: () => `expected ${stringify(received)} to be an instance of ${ctor && ctor.name}`,
  }),
  toBeGreaterThan: (received, n) => ({
    pass: received > n,
    message: () => `expected ${stringify(received)} to be greater than ${n}`,
  }),
  toBeGreaterThanOrEqual: (received, n) => ({
    pass: received >= n,
    message: () => `expected ${stringify(received)} to be >= ${n}`,
  }),
  toContain: (received, item) => ({
    pass:
      typeof received === 'string'
        ? received.includes(item)
        : Array.isArray(received) && received.some((candidate) => equals(candidate, item)),
    message: () => `expected ${stringify(received)} to contain ${stringify(item)}`,
  }),
  toMatch: (received, expected) => {
    const regex = typeof expected === 'string' ? new RegExp(escapeRegExp(expected)) : expected
    return {
      pass: typeof received === 'string' && regex.test(received),
      message: () => `expected ${stringify(received)} to match ${regex}`,
    }
  },
  toMatchObject: (received, expected) => ({
    pass: matchesObject(received, expected),
    message: () => `expected ${stringify(received)} to match object ${stringify(expected)}`,
  }),
}

function assert(pass, isNot, describe) {
  if (pass === !isNot) return
  throw new Error(`${isNot ? 'not.' : ''}${describe()}`)
}

function makeToThrow({ isNot, received, rejection }) {
  return (expected) => {
    let error
    let threw

    if (rejection !== undefined) {
      threw = rejection !== NO_ERROR
      error = rejection === NO_ERROR ? undefined : rejection
    } else {
      if (typeof received !== 'function') {
        throw new Error('toThrow: matcher received a value that is not a function')
      }
      try {
        received()
        threw = false
      } catch (caught) {
        error = caught
        threw = true
      }
    }

    const pass = threw && errorMatches(error, expected)
    assert(pass, isNot, () =>
      threw
        ? `toThrow: threw ${stringify(error && error.message)} which does not match ${stringify(expected)}`
        : 'toThrow: function did not throw',
    )
  }
}

function makeExpectation(received, { isNot = false, rejection } = {}) {
  const api = {}

  for (const [name, matcher] of Object.entries(MATCHERS)) {
    api[name] = (...args) => {
      const { pass, message } = matcher(received, ...args)
      assert(pass, isNot, () => `${name}: ${message()}`)
    }
  }

  api.toThrow = makeToThrow({ isNot, received, rejection })
  api.toThrowError = api.toThrow

  if (!isNot) {
    Object.defineProperty(api, 'not', {
      get: () => makeExpectation(received, { isNot: true, rejection }),
    })
  }

  return api
}

function makeRejects(promise, { isNot = false } = {}) {
  const run = (apply) => async () => {
    let rejection = NO_ERROR
    try {
      await promise
    } catch (caught) {
      rejection = caught
    }
    if (rejection === NO_ERROR) {
      throw new Error('rejects: expected promise to reject, but it resolved')
    }
    return apply(rejection)
  }

  const proxy = {}
  for (const name of Object.keys(MATCHERS)) {
    proxy[name] = (...args) =>
      run((rejection) => makeExpectation(rejection, { isNot })[name](...args))()
  }
  proxy.toThrow = (...args) =>
    run((rejection) => makeExpectation(undefined, { isNot, rejection }).toThrow(...args))()
  proxy.toThrowError = proxy.toThrow

  if (!isNot) {
    Object.defineProperty(proxy, 'not', {
      get: () => makeRejects(promise, { isNot: true }),
    })
  }

  return proxy
}

function expect(received) {
  const api = makeExpectation(received)
  Object.defineProperty(api, 'rejects', {
    get: () => makeRejects(received),
  })
  return api
}

expect.arrayContaining = (sample) => new ArrayContaining(sample)
expect.stringMatching = (sample) => new StringMatching(sample)

export default expect
export { expect }
