import areRecordsEqual from '../../utils/fp/areRecordsEqual'
import { logError } from '../../utils/common'
import type { Database, Model, TableName } from '../..'

import { prepareMarkAsSynced } from './helpers'
import type { SyncLocalChanges, SyncRejectedIds } from '../index'

const recordsToMarkAsSynced = (
  { changes, affectedRecords }: SyncLocalChanges,
  allRejectedIds: SyncRejectedIds,
): Model[] => {
  const syncedRecords: Model[] = []

  Object.keys(changes).forEach((table) => {
    const tableChanges = changes[table as TableName]
    if (!tableChanges) {
      return
    }
    const { created, updated } = tableChanges
    const raws = created.concat(updated)
    const rejectedIds = new Set(allRejectedIds[table as TableName] ?? [])

    raws.forEach((raw) => {
      const { id } = raw
      const record = affectedRecords.find((model) => model.id === id && model.table === table)
      if (!record) {
        logError(
          `[Sync] Looking for record ${table}#${String(id)} to mark it as synced, but I can't find it. Will ignore it (it should get synced next time). This is probably a Watermelon bug — please file an issue!`,
        )
        return
      }
      if (typeof id === 'string' && areRecordsEqual(record._raw, raw) && !rejectedIds.has(id)) {
        syncedRecords.push(record)
      }
    })
  })
  return syncedRecords
}

const destroyDeletedRecords = (
  db: Database,
  { changes }: SyncLocalChanges,
  allRejectedIds: SyncRejectedIds,
): Promise<void>[] =>
  Object.keys(changes).map((tableName) => {
    const table = tableName as TableName
    const rejectedIds = new Set(allRejectedIds[table] ?? [])
    const deleted = (changes[table]?.deleted ?? []).filter((id) => !rejectedIds.has(id))
    return deleted.length ? db.adapter.destroyDeletedRecords(table, deleted) : Promise.resolve()
  })

export default function markLocalChangesAsSynced(
  db: Database,
  syncedLocalChanges: SyncLocalChanges,
  rejectedIds?: SyncRejectedIds | null,
): Promise<void> {
  return db.write(async () => {
    // update and destroy records concurrently
    await Promise.all([
      db.batch(
        recordsToMarkAsSynced(syncedLocalChanges, rejectedIds || {}).map(prepareMarkAsSynced),
      ),
      ...destroyDeletedRecords(db, syncedLocalChanges, rejectedIds || {}),
    ])
  }, 'sync-markLocalChangesAsSynced')
}
