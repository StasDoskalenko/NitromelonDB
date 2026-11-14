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

// Where a paginated pull continues: whatever the server put in `nextCursor` (a string, a number, or a
// JSON object), passed back as it is. It's saved in the local database between pages, so it must
// survive JSON.stringify.
export type SyncPullCursor = string | number | { [key: string]: unknown } | unknown[]

export type SyncPullArgs = {
  lastPulledAt?: Timestamp | null | undefined
  schemaVersion: SchemaVersion
  migration: MigrationSyncChanges
  // Only with `paginatedPulls: true`, for the second and later pages of a paginated pull (including
  // the first pull of a sync that continues one that was interrupted): the `nextCursor` of the
  // previous page
  cursor?: SyncPullCursor | undefined
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
      // Paginated pulls (only with `paginatedPulls: true`, ignored otherwise): if set, this is one
      // page of the changes, and synchronize() calls
      // pullChanges() again with `cursor: nextCursor` (and the same lastPulledAt, schemaVersion and
      // migration) for the next one. Each page is applied in its own write. lastPulledAt only moves to
      // `timestamp` of the last page (the one without nextCursor) once every page is applied; if a
      // sync stops halfway, the next one continues from the saved cursor. null, a missing field,
      // false or '' mean this is the last page. See docs for details.
      nextCursor?: SyncPullCursor | null | false | undefined
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
  // Number of pullChanges() calls (more than 1 for a paginated pull)
  pulledPages?: number | undefined
  // The first pull continued a paginated pull that an earlier sync didn't finish
  resumedPullCursor?: boolean | undefined
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
  // commits changes in multiple batches (of up to 5000 records, one after another), and not one.
  // This shrinks the payload of each batch sent to the native database, NOT the JS memory used by
  // sync - all pulled changes are still in memory. Not transactional: if a batch fails, earlier
  // batches stay committed. Observers are notified once, after all batches
  _unsafeBatchPerCollection?: boolean | undefined
  // Advanced optimization - pullChanges must return syncJson or syncJsonId to be processed by native code.
  // This can only be used on initial (login) sync, not for incremental syncs.
  // This can only be used with SQLiteAdapter with JSI enabled.
  // The exact API may change between versions of WatermelonDB.
  // See documentation for more details.
  unsafeTurbo?: boolean | undefined
  // Called after changes are pulled with whatever was returned by pullChanges, minus `changes`. Useful
  // when using turbo mode. Called once per page in a paginated pull, after that page is applied
  onDidPullChanges?: ((payload: Record<string, unknown>) => Promise<void>) | undefined
  // Called after pullChanges is done, but before these changes are applied. Some stats about the pulled
  // changes are passed as arguments. An advanced user can use this for example to show some UI to the user
  // when processing a very large sync (could be useful for replacement syncs). Note that remote change count
  // is NaN in turbo mode. Called once per page in a paginated pull, with that page's count.
  onWillApplyRemoteChanges?: ((info: { remoteChangeCount: number }) => Promise<void>) | undefined
  // Opt-in: if true, a `nextCursor` returned by pullChanges() means more pages follow, and
  // synchronize() pulls them one after another (each applied in its own write, lastPulledAt moved
  // after the last one, an interrupted pull continued next time). Without it, nextCursor is ignored.
  // Your server should also only page when the app asks for it. See docs (Sync / Frontend,
  // Paginated pulls) for details.
  paginatedPulls?: boolean | undefined
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
  return (
    require('./impl') as { hasUnsyncedChanges: (db: Database) => Promise<boolean> }
  ).hasUnsyncedChanges(database)
}
