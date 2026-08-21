import { testSchema } from '../helpers'
import SQLiteAdapter from '../../sqlite/index'
import DatabaseAdapterCompat from '../../compat'

/**
 * Generate a unique database name for file-backed tests.
 * On node: `.tmp/<name>.db`
 * On device: `<name>.db` (resolved via platform-specific path resolution)
 */
export function fileDbName(platform) {
  const id = Math.random().toString(36).slice(2, 10)
  if (platform === 'node') {
    return `.tmp/test-sqlite-${id}.db`
  }
  return `test-sqlite-${id}.db`
}

/**
 * Create a file-backed adapter wrapped in DatabaseAdapterCompat.
 */
export async function createFileAdapter(platform, options = {}) {
  const { schema = testSchema, migrations, dbName: explicitDbName, ...rest } = options
  const dbName = explicitDbName || fileDbName(platform)
  const underlying = new SQLiteAdapter({
    dbName,
    schema,
    ...(migrations ? { migrations } : {}),
    ...rest,
  })
  await underlying.initializingPromise
  return {
    adapter: new DatabaseAdapterCompat(underlying),
    underlying,
    dbName,
  }
}

/**
 * Open a second adapter on an existing file (also Compat-wrapped).
 */
export async function openFileAdapter(dbName, options = {}) {
  const { schema = testSchema, migrations, ...rest } = options
  const underlying = new SQLiteAdapter({
    dbName,
    schema,
    ...(migrations ? { migrations } : {}),
    ...rest,
  })
  await underlying.initializingPromise
  return {
    adapter: new DatabaseAdapterCompat(underlying),
    underlying,
    dbName,
  }
}

/**
 * Reopen an adapter on the same file (for testing migration across restarts).
 */
export async function reopen(adapter, options = {}) {
  return adapter.testClone(options)
}

/**
 * Node `fs` without a static `require('fs')` so Metro/RN bundles do not try to resolve it.
 */
function nodeFs() {
  // eslint-disable-next-line no-eval
  return eval('require')('fs')
}

/**
 * Clean up a file-backed test database and its sidecars.
 * On node: removes .tmp/<name>.db
 * On device: no-op (no FS API in the RN bundle).
 */
export function cleanupDb(dbName, platform) {
  if (platform !== 'node') {
    return
  }
  const fs = nodeFs()
  for (const path of [dbName, `${dbName}-wal`, `${dbName}-shm`]) {
    try {
      fs.unlinkSync(path)
    } catch (_) {
      // Ignore ENOENT
    }
  }
}

/**
 * Assert that a database file exists on disk (node only).
 */
export function assertDbExists(dbName, platform) {
  if (platform !== 'node') {
    return
  }
  const fs = nodeFs()
  if (!fs.existsSync(dbName)) {
    throw new Error(`Expected database file ${dbName} to exist on disk`)
  }
}

/**
 * Assert that WAL and SHM sidecar files exist (or don't). Node only.
 */
export function assertSidecars(dbName, platform, { expectWal, expectShm }) {
  if (platform !== 'node') {
    return
  }
  const fs = nodeFs()
  const walPath = `${dbName}-wal`
  const shmPath = `${dbName}-shm`
  if (expectWal && !fs.existsSync(walPath)) {
    throw new Error(`Expected WAL file ${walPath} to exist`)
  }
  if (expectShm && !fs.existsSync(shmPath)) {
    throw new Error(`Expected SHM file ${shmPath} to exist`)
  }
}

export { testSchema }
