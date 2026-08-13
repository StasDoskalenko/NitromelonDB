import type { Database, RecordId, TableName, Model } from '..'
import type { Where } from '../QueryDescription'
import type { DirtyRaw } from '../RawRecord'

import type { SchemaVersion } from '../Schema'
import type { MigrationSyncChanges } from '../Schema/migrations/getSyncChanges'

export type Timestamp = number

export type SyncTableChangeSet = {
  created: DirtyRaw[]
  updated: DirtyRaw[]
  deleted: RecordId[]
}
export type SyncDatabaseChangeSet = { [tableName: TableName]: SyncTableChangeSet }

export type SyncLocalChanges = { changes: SyncDatabaseChangeSet; affectedRecords: Model[] }

export type SyncPullArgs = {
  lastPulledAt?: Timestamp | null | undefined
  schemaVersion: SchemaVersion
  migration: MigrationSyncChanges
}
export type SyncPullStrategyType =
  // Standard sync strategy (default)
  | 'incremental'
  // Advanced alternative strategy: indicates that `changes` contains a full dataset (same as during
  // initial sync). Local records not present in the changeset will be deleted. Other records will be
  // applied as usual (created, updated, local update conflicts resolved).
  // This is useful to recover from a corrupted local database, or to deal with very large state changes
  // such that server doesn't know how to efficiently send incremental changes and wants to send a full
  // changeset instead.
  // See docs for more details.
  | 'replacement'
export type SyncPullStrategy =
  | SyncPullStrategyType
  | {
      default: SyncPullStrategyType
      override: { [tableName: TableName]: SyncPullStrategyType }
      experimentalQueryRecordsForReplacement?:
        | { [tableName: TableName]: () => Where[] }
        | undefined
    }

export type SyncPullResult =
  | {
      changes: SyncDatabaseChangeSet
      timestamp: Timestamp
      experimentalStrategy?: SyncPullStrategy | undefined
    }
  | { syncJson: string }
  | { syncJsonId: number }

export type SyncRejectedIds = { [tableName: TableName]: RecordId[] }

export type SyncPushArgs = { changes: SyncDatabaseChangeSet; lastPulledAt: Timestamp }

export type SyncPushResult = { experimentalRejectedIds?: SyncRejectedIds | undefined }

export type SyncConflict = { local: DirtyRaw; remote: DirtyRaw; resolved: DirtyRaw }
export type SyncLog = {
  startedAt?: Date | undefined
  lastPulledAt?: Timestamp | null | undefined
  lastPulledSchemaVersion?: SchemaVersion | null | undefined
  migration?: MigrationSyncChanges | undefined
  newLastPulledAt?: number | undefined
  resolvedConflicts?: SyncConflict[] | undefined
  rejectedIds?: SyncRejectedIds | undefined
  finishedAt?: Date | undefined
  remoteChangeCount?: number | undefined
  localChangeCount?: number | undefined
  phase?: string | undefined // NOTE: an textual information, not a stable API!
  error?: Error | undefined
}

export type SyncConflictResolver = (
  table: TableName,
  local: DirtyRaw,
  remote: DirtyRaw,
  resolved: DirtyRaw,
) => DirtyRaw

export type SyncArgs = {
  database: Database
  pullChanges: (args: SyncPullArgs) => Promise<SyncPullResult>
  pushChanges?: ((args: SyncPushArgs) => Promise<SyncPushResult | null | undefined | void>) | undefined
  // version at which support for migration syncs was added - the version BEFORE first syncable migration
  migrationsEnabledAtVersion?: SchemaVersion | undefined
  sendCreatedAsUpdated?: boolean | undefined
  log?: SyncLog | undefined
  // Advanced (unsafe) customization point. Useful when you have subtle invariants between multiple
  // columns and want to have them updated consistently, or to implement partial sync
  // It's called for every record being updated locally, so be sure that this function is FAST.
  // If you don't want to change default behavior for a given record, return `resolved` as is
  // Note that it's safe to mutate `resolved` object, so you can skip copying it for performance.
  conflictResolver?: SyncConflictResolver | undefined
  // commits changes in multiple batches, and not one - temporary workaround for memory issue
  _unsafeBatchPerCollection?: boolean | undefined
  // Advanced optimization - pullChanges must return syncJson or syncJsonId to be processed by native code.
  // This can only be used on initial (login) sync, not for incremental syncs.
  // This can only be used with SQLiteAdapter with JSI enabled.
  // The exact API may change between versions of WatermelonDB.
  // See documentation for more details.
  unsafeTurbo?: boolean | undefined
  // Called after changes are pulled with whatever was returned by pullChanges, minus `changes`. Useful
  // when using turbo mode
  onDidPullChanges?: ((payload: Record<string, unknown>) => Promise<void>) | undefined
  // Called after pullChanges is done, but before these changes are applied. Some stats about the pulled
  // changes are passed as arguments. An advanced user can use this for example to show some UI to the user
  // when processing a very large sync (could be useful for replacement syncs). Note that remote change count
  // is NaN in turbo mode.
  onWillApplyRemoteChanges?: ((info: { remoteChangeCount: number }) => Promise<void>) | undefined
}

/**
 * Synchronizes database with a remote server
 *
 * See docs for more details
 */
export async function synchronize(args: SyncArgs): Promise<void> {
  try {
    const synchronizeImpl = (
      require('./impl/synchronize') as { default: (args: SyncArgs) => Promise<void> }
    ).default
    await synchronizeImpl(args)
  } catch (error) {
    if (args.log && error instanceof Error) {
      args.log.error = error
    }
    throw error
  }
}

/**
 * Returns `true` if database has any unsynced changes.
 *
 * Use this to check if you can safely log out (delete the database)
 */
export function hasUnsyncedChanges({ database }: { database: Database }): Promise<boolean> {
  return (require('./impl') as { hasUnsyncedChanges: (db: Database) => Promise<boolean> }).hasUnsyncedChanges(
    database,
  )
}
