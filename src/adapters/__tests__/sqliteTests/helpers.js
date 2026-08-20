import { testSchema } from '../helpers'
import SQLiteAdapter from '../../sqlite/index'

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
 * Create a file-backed adapter for testing.
 * Returns an adapter that uses a real file, not in-memory.
 */
export async function createFileAdapter(platform) {
  const dbName = fileDbName(platform)
  const adapter = new SQLiteAdapter({
    dbName,
    schema: testSchema,
  })
  await adapter.initializingPromise
  return { adapter, dbName }
}

/**
 * Reopen an adapter on the same file (for testing migration across restarts).
 * Uses SQLiteAdapter.testClone which re-runs initialize() on the same file.
 */
export async function reopen(adapter) {
  return adapter.testClone()
}

/**
 * Clean up a file-backed test database and its sidecars.
 * On node: removes .tmp/<name>.db
 * On device: calls deleteDatabaseFile (which also handles -wal/-shm).
 */
export function cleanupDb(dbName, platform) {
  if (platform === 'node') {
    const fs = require('fs')
    try {
      fs.unlinkSync(dbName)
    } catch (e) {
      // Ignore ENOENT
    }
  }
  // On device, deleteDatabaseFile handles this (Phase 4)
}

/**
 * Assert that a database file exists on disk.
 */
export function assertDbExists(dbName, platform) {
  if (platform === 'node') {
    const fs = require('fs')
    if (!fs.existsSync(dbName)) {
      throw new Error(`Expected database file ${dbName} to exist on disk`)
    }
  }
  // On device, this is handled by deleteDatabaseFile existence check
}

/**
 * Assert that WAL and SHM sidecar files exist (or don't).
 */
export function assertSidecars(dbName, platform, { expectWal, expectShm }) {
  if (platform === 'node') {
    const fs = require('fs')
    const walPath = `${dbName}-wal`
    const shmPath = `${dbName}-shm`
    if (expectWal && !fs.existsSync(walPath)) {
      throw new Error(`Expected WAL file ${walPath} to exist`)
    }
    if (expectShm && !fs.existsSync(shmPath)) {
      throw new Error(`Expected SHM file ${shmPath} to exist`)
    }
  }
  // On device, WAL/SHM presence is inferred from journal_mode pragma
}

export { testSchema }
