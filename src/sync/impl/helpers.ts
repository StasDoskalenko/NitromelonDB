import { values } from '../../utils/fp'
import areRecordsEqual from '../../utils/fp/areRecordsEqual'
import { invariant } from '../../utils/common'

import type { Model, Collection, Database } from '../..'
import { type RawRecord, type DirtyRaw, sanitizedRaw } from '../../RawRecord'
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

  // Note COPY for log - only if needed
  const logConflict = log && !!localRaw._changed
  const logLocal = logConflict ? { ...localRaw } : {}
  const logRemote = logConflict ? { ...remoteDirtyRaw } : {}

  let newRaw = resolveConflict(localRaw, remoteDirtyRaw)

  if (conflictResolver) {
    newRaw = conflictResolver(collection.table, localRaw, remoteDirtyRaw, newRaw)
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
