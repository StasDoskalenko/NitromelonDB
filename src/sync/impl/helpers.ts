import { values } from '../../utils/fp'
import areRecordsEqual from '../../utils/fp/areRecordsEqual'
import { invariant } from '../../utils/common'

import type { Model, Collection, Database } from '../..'
import { type RawRecord, type DirtyRaw, sanitizedRaw, nullValue } from '../../RawRecord'
import type { TableSchema } from '../../Schema'
import type { SyncLog, SyncDatabaseChangeSet, SyncConflictResolver } from '../index'

// Returns raw record with naive solution to a conflict based on local `_changed` field
// This is a per-column resolution algorithm. All columns that were changed locally win
// and will be applied on top of the remote version.
export function resolveConflict(local: RawRecord, remote: DirtyRaw): DirtyRaw {
  // We SHOULD NOT have a reference to a `deleted` record, but since it was locally
  // deleted, there's nothing to update, since the local deletion will still be pushed to the server -- return raw as is
  if (local._status === 'deleted') {
    return local
  }

  // mutating code - performance-critical path
  const resolved: DirtyRaw = {
    // use local fields if remote is missing columns (shouldn't but just in case)
    ...local,
    // Note: remote MUST NOT have a _status of _changed fields (will replace them anyway just in case)
    ...remote,
    id: local.id,
    _status: local._status,
    _changed: local._changed,
  }

  // Use local properties where changed
  local._changed.split(',').forEach((column) => {
    resolved[column] = local[column]
  })

  return resolved
}

// Columns set locally on a record created here and not pushed yet, for resolving a conflict with a
// pulled record of the same id. Creating a record doesn't record its columns in `_changed` (that
// would make every created row bigger until it's synced), so they're inferred: every column whose
// value isn't the column's default (null, or '' / 0 / false if not optional), plus the columns
// changed by updates since (which are in `_changed`). A column explicitly set to its default value
// counts as not set, so the server's value wins for it. This only runs on a record's first
// conflict: resolving it turns the record into a local update, with these columns in `_changed`.
export function inferLocallySetColumns(local: RawRecord, schema: TableSchema): string {
  const columns = local._changed ? local._changed.split(',') : []
  schema.columnArray.forEach((column) => {
    if (local[column.name] !== nullValue(column) && !columns.includes(column.name)) {
      columns.push(column.name)
    }
  })
  return columns.join(',')
}

function replaceRaw(record: Model, dirtyRaw: DirtyRaw): void {
  record._raw = sanitizedRaw(dirtyRaw, record.collection.schema)
}

export function prepareCreateFromRaw<T extends Model>(collection: Collection<T>, dirtyRaw: DirtyRaw): T {
  // TODO: Think more deeply about this - it's probably unnecessary to do this check, since it would
  // mean malicious sync server, which is a bigger problem
  invariant(
    !Object.prototype.hasOwnProperty.call(dirtyRaw, '__proto__'),
    'Malicious dirtyRaw detected - contains a __proto__ key',
  )
  const raw = Object.assign({}, dirtyRaw, { _status: 'synced', _changed: '' }) // faster than object spread
  return collection.prepareCreateFromDirtyRaw(raw)
}

// optimization - don't run DB update if received record is the same as local
// (this happens a lot during replacement sync)
export function requiresUpdate<T extends Model>(
  collection: Collection<T>,
  local: RawRecord,
  dirtyRemote: DirtyRaw,
): boolean {
  if (local._status !== 'synced') {
    return true
  }

  const remote = sanitizedRaw(dirtyRemote, collection.schema)
  remote._status = 'synced'

  const canSkipSafely = areRecordsEqual(local, remote)
  return !canSkipSafely
}

export const recordFromRaw = <T extends Model>(raw: RawRecord, collection: Collection<T>): T =>
  collection._cache._modelForRaw(raw, false)

export function prepareUpdateFromRaw<T extends Model>(
  localRaw: RawRecord,
  remoteDirtyRaw: DirtyRaw,
  collection: Collection<T>,
  log?: SyncLog | null,
  conflictResolver?: SyncConflictResolver,
): T | null {
  if (!requiresUpdate(collection, localRaw, remoteDirtyRaw)) {
    return null
  }

  const local = recordFromRaw(localRaw, collection)

  // A locally created record has no `_changed` from its creation; see inferLocallySetColumns
  const localForResolution =
    localRaw._status === 'created'
      ? { ...localRaw, _changed: inferLocallySetColumns(localRaw, collection.schema) }
      : localRaw

  // Note COPY for log - only if needed
  const logConflict = log && !!localForResolution._changed
  const logLocal = logConflict ? { ...localRaw } : {}
  const logRemote = logConflict ? { ...remoteDirtyRaw } : {}

  let newRaw = resolveConflict(localForResolution, remoteDirtyRaw)
  if (localRaw._status === 'created') {
    // The server has this record now, so the local one becomes an update of it, with the inferred
    // columns recorded. Later conflicts (e.g. another pull before the push succeeds) then resolve
    // by `_changed`, instead of inferring the server's values from this pull as locally set too.
    newRaw._status = localForResolution._changed ? 'updated' : 'synced'
  }

  if (conflictResolver) {
    newRaw = conflictResolver(collection.table, localForResolution, remoteDirtyRaw, newRaw)
  }

  return local.prepareUpdate(() => {
    replaceRaw(local, newRaw)

    // log resolved conflict - if any
    if (logConflict && log) {
      log.resolvedConflicts = log.resolvedConflicts || []
      log.resolvedConflicts.push({
        local: logLocal,
        remote: logRemote,
        resolved: { ...newRaw },
      })
    }
  })
}

export function prepareMarkAsSynced<T extends Model>(record: T): T {
  const newRaw = Object.assign({}, record._raw, { _status: 'synced', _changed: '' }) // faster than object spread
  return record.prepareUpdate(() => {
    replaceRaw(record, newRaw)
  })
}

export function ensureSameDatabase(database: Database, initialResetCount: number): void {
  invariant(
    database._resetCount === initialResetCount,
    `[Sync] Sync aborted because database was reset`,
  )
}

export const isChangeSetEmpty = (changeset: SyncDatabaseChangeSet): boolean =>
  values(changeset).every(
    ({ created, updated, deleted }) => created.length + updated.length + deleted.length === 0,
  )

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)
export const changeSetCount = (changeset: SyncDatabaseChangeSet): number =>
  sum(
    values(changeset).map(
      ({ created, updated, deleted }) => created.length + updated.length + deleted.length,
    ),
  )
