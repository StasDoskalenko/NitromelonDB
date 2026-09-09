import browserExpect from '../../../../src/__tests__/expect'

import SQLiteAdapterTest from 'nitromelondb/adapters/sqlite/integrationTest'

global.expect = browserExpect

const testTimeoutMs = 30_000

const formatError = (error) => {
  if (!(error instanceof Error)) return String(error)
  const summary = `${error.name}: ${error.message}`
  if (!error.stack) return summary
  // Some browser assertion libraries generate a useful message but replace
  // the stack's first line with a bare "Error". Never hide that diagnostic.
  return error.stack.includes(error.message) ? error.stack : `${summary}\n${error.stack}`
}

const withTimeout = (promise, name) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out after ${testTimeoutMs}ms: ${name}`)),
      testTimeoutMs,
    )
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })

export default async function runWebAdapterTests(onProgress = () => {}) {
  const cases = []
  const nameStack = []
  const spec = {
    describe(name, register) {
      nameStack.push(name)
      register()
      nameStack.pop()
    },
    it(name, test) {
      cases.push({ name: [...nameStack, name].join(' > '), test })
    },
  }

  SQLiteAdapterTest(spec)

  const results = []
  for (const [index, testCase] of cases.entries()) {
    onProgress({ current: index + 1, total: cases.length, name: testCase.name })
    try {
      await withTimeout(Promise.resolve().then(() => testCase.test()), testCase.name)
      results.push({ name: testCase.name, passed: true })
    } catch (error) {
      results.push({
        name: testCase.name,
        passed: false,
        error: formatError(error),
      })
    }
  }

  const failures = results.filter(({ passed }) => !passed)
  return { total: results.length, passed: results.length - failures.length, failures, results }
}
