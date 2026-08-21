/* eslint-disable jest/no-standalone-expect */
import migrations from './migrations'
import batches from './batches'
import concurrency from './concurrency'
import cleanup from './cleanup'
import databaseLevel from './databaseLevel'

/**
 * SQLite-specific tests that require a file-backed database.
 * These tests run against real SQLite (better-sqlite3 on node, native SQLite on device)
 * and are NOT compatible with LokiJSAdapter.
 *
 * Returns [name, testFn][] pairs in the same format as commonTests.
 */
export default () => {
  const tests = []
  const it = (name, testFn) => tests.push([name, testFn])

  migrations(it)
  batches(it)
  concurrency(it)
  cleanup(it)
  databaseLevel(it)

  return tests
}
