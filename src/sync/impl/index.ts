import type { Database } from '../..'
import { invariant, logError, logger } from '../../utils/common'

import type { Timestamp, SyncLog, SyncPullCursor } from '../index'
import type { SchemaVersion } from '../../Schema'
import getSyncChanges, { type MigrationSyncChanges } from '../../Schema/migrations/getSyncChanges'

export { default as applyRemoteChanges } from './applyRemote'
export { default as fetchLocalChanges, hasUnsyncedChanges } from './fetchLocal'
export { default as markLocalChangesAsSynced } from './markAsSynced'

const lastPulledAtKey = '__watermelon_last_pulled_at'
const lastPulledSchemaVersionKey = '__watermelon_last_pulled_schema_version'
const pullCursorKey = '__watermelon_pull_cursor'

export async function getLastPulledAt(database: Database): Promise<Timestamp | null> {
  return parseInt((await database.adapter.getLocal(lastPulledAtKey)) ?? '', 10) || null
}

export async function setLastPulledAt(database: Database, timestamp: Timestamp): Promise<void> {
  const previousTimestamp = (await getLastPulledAt(database)) || 0
  if (timestamp < previousTimestamp) {
    logError(
      `[Sync] Pull has finished and received server time ${timestamp} — but previous pulled-at time was greater - ${previousTimestamp}. This is most likely server bug.`,
    )
  }

  await database.adapter.setLocal(lastPulledAtKey, `${timestamp}`)
}

export async function getLastPulledSchemaVersion(
  database: Database,
): Promise<SchemaVersion | null> {
  return parseInt((await database.adapter.getLocal(lastPulledSchemaVersionKey)) ?? '', 10) || null
}

export async function setLastPulledSchemaVersion(
  database: Database,
  version: SchemaVersion,
): Promise<void> {
  await database.adapter.setLocal(lastPulledSchemaVersionKey, `${version}`)
}

// A paginated pull that isn't finished: the cursor of the next page, and what it was pulled for. Saved
// in the same write as each page, so it always matches what's in the database.
export type SavedPullCursor = {
  lastPulledAt: Timestamp | null
  schemaVersion: SchemaVersion
  cursor: SyncPullCursor
}

export async function getSavedPullCursor(database: Database): Promise<string | null> {
  return (await database.adapter.getLocal(pullCursorKey)) ?? null
}

export function parseSavedPullCursor(saved: string | null): SavedPullCursor | null {
  if (!saved) {
    return null
  }
  try {
    const parsed = JSON.parse(saved) as Partial<SavedPullCursor> | null
    return parsed && typeof parsed === 'object' && parsed.cursor != null && 'lastPulledAt' in parsed
      ? (parsed as SavedPullCursor)
      : null
  } catch {
    return null
  }
}

// Strings, numbers, booleans, null, arrays and plain objects of those: what JSON keeps as it is
function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value) as unknown
    return (
      (prototype === Object.prototype || prototype === null) &&
      Object.values(value as object).every(isJsonValue)
    )
  }
  return false
}

export function serializePullCursor(saved: SavedPullCursor): string {
  invariant(
    isJsonValue(saved.cursor),
    "[Sync] pullChanges() returned a nextCursor that can't be saved as JSON. Use a string, a number, or a plain object or array of those",
  )
  return JSON.stringify(saved)
}

export async function setSavedPullCursor(database: Database, serialized: string): Promise<void> {
  await database.adapter.setLocal(pullCursorKey, serialized)
}

export async function removeSavedPullCursor(database: Database): Promise<void> {
  await database.adapter.removeLocal(pullCursorKey)
}

export type MigrationInfo = {
  schemaVersion: SchemaVersion
  migration: MigrationSyncChanges
  shouldSaveSchemaVersion: boolean
}

export async function getMigrationInfo(
  database: Database,
  log: SyncLog | null | undefined,
  lastPulledAt: Timestamp | null | undefined,
  migrationsEnabledAtVersion: SchemaVersion | null | undefined,
): Promise<MigrationInfo> {
  const isFirstSync = !lastPulledAt
  const schemaVersion = database.schema.version

  const lastPulledSchemaVersion = await getLastPulledSchemaVersion(database)
  log && (log.lastPulledSchemaVersion = lastPulledSchemaVersion)

  const areMigrationsEnabled = !!migrationsEnabledAtVersion
  const { migrations } = database.adapter
  if (lastPulledSchemaVersion && isFirstSync) {
    logError(
      '[Sync] lastPulledSchemaVersion is set, but this is the first sync. This most likely means that the backend does not return a correct timestamp',
    )
  }
  if (areMigrationsEnabled) {
    invariant(
      typeof migrationsEnabledAtVersion === 'number' && migrationsEnabledAtVersion >= 1,
      '[Sync] Invalid migrationsEnabledAtVersion',
    )
    invariant(
      migrationsEnabledAtVersion <= schemaVersion,
      '[Sync] migrationsEnabledAtVersion must not be greater than current schema version',
    )
    invariant(
      migrations,
      '[Sync] Migration syncs cannot be enabled on a database that does not support migrations',
    )
    invariant(
      migrationsEnabledAtVersion >= migrations.minVersion,
      `[Sync] migrationsEnabledAtVersion is too low - not possible to migrate from schema version ${migrationsEnabledAtVersion}`,
    )
    lastPulledSchemaVersion &&
      invariant(
        lastPulledSchemaVersion <= schemaVersion,
        `[Sync] Last synced schema version (${lastPulledSchemaVersion}) is greater than current schema version (${schemaVersion}). This indicates programmer error`,
      )
  }

  const migrateFrom = lastPulledSchemaVersion || migrationsEnabledAtVersion || 0
  const shouldMigrate = areMigrationsEnabled && migrateFrom < schemaVersion && !isFirstSync
  const migration =
    migrations && shouldMigrate ? getSyncChanges(migrations, migrateFrom, schemaVersion) : null

  log && (log.migration = migration)

  if (migration) {
    logger.log(`[Sync] Performing migration sync from ${migrateFrom} to ${schemaVersion}`)
    if (!lastPulledSchemaVersion) {
      logger.warn(
        `[Sync] Using fallback initial schema version. The migration sync might not contain all necessary migrations`,
      )
    }
  }

  return {
    schemaVersion,
    migration,
    shouldSaveSchemaVersion: shouldMigrate || isFirstSync,
  }
}
