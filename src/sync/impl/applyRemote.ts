import { mapObj, filterObj, toPairs } from '../../utils/fp'
import splitEvery from '../../utils/fp/splitEvery'
import allPromisesObj from '../../utils/fp/allPromisesObj'
import { toPromise } from '../../utils/fp/Result'
import { logError, invariant, logger } from '../../utils/common'
import type {
  Database,
  RecordId,
  Collection,
  Model,
  TableName,
  DirtyRaw,
  Query,
  RawRecord,
} from '../..'
import type { CachedQueryResult } from '../../adapters/type'
import * as Q from '../../QueryDescription'
import { columnName } from '../../Schema'

import type {
  SyncTableChangeSet,
  SyncDatabaseChangeSet,
  SyncLog,
  SyncConflictResolver,
  SyncPullStrategy,
  SyncPullStrategyType,
} from '../index'
import { prepareCreateFromRaw, prepareUpdateFromRaw, recordFromRaw } from './helpers'

export type ApplyRemoteChangesContext = {
  db: Database
  strategy?: SyncPullStrategy | null | undefined
  sendCreatedAsUpdated?: boolean | undefined
  log?: SyncLog | undefined
  conflictResolver?: SyncConflictResolver | undefined
  _unsafeBatchPerCollection?: boolean | undefined
}

// NOTE: Creating JS models is expensive/memory-intensive, so we want to avoid it if possible
// In replacement sync, we can avoid it if record already exists and didn't change. Note that we're not
// using unsafeQueryRaw, because we DO want to reuse JS model if already in memory
// This is only safe to do within a single db.write block, because otherwise we risk that the record
// changed and we can no longer instantiate a JS model from an outdated raw record
const unsafeFetchAsRaws = async <T extends Model>(query: Query<T>): Promise<RawRecord[]> => {
  const { db } = query.collection
  const result = await toPromise<CachedQueryResult>((callback) =>
    db.adapter.underlyingAdapter.query(query.serialize(), callback),
  )
  const raws = query.collection._cache.rawRecordsFromQueryResult(result)
  // FIXME: The above actually causes RecordCache corruption, because we're not adding record to
  // RecordCache, but adapter notes that we did. Temporary quick fix below to undo the optimization.
  raws.forEach((raw) => {
    query.collection._cache._modelForRaw(raw, false)
  })

  return raws
}

const dirtyRawId = (record: DirtyRaw): RecordId => record.id as RecordId

const idsForChanges = ({ created, updated, deleted }: SyncTableChangeSet): RecordId[] => {
  const ids: RecordId[] = []
  created.forEach((record) => {
    ids.push(dirtyRawId(record))
  })
  updated.forEach((record) => {
    ids.push(dirtyRawId(record))
  })
  return ids.concat(deleted)
}

const fetchRecordsForChanges = <T extends Model>(
  collection: Collection<T>,
  changes: SyncTableChangeSet,
): Promise<RawRecord[]> => {
  const ids = idsForChanges(changes)

  if (ids.length) {
    return unsafeFetchAsRaws(collection.query(Q.where(columnName('id'), Q.oneOf(ids))))
  }

  return Promise.resolve([])
}

type RecordsToApplyRemoteChangesTo<T extends Model> = SyncTableChangeSet & {
  recordsMap: Map<RecordId, RawRecord>
  recordsToDestroy: T[]
  locallyDeletedIds: RecordId[]
  deletedRecordsToDestroy: RecordId[]
}

async function recordsToApplyRemoteChangesTo_incremental<T extends Model>(
  collection: Collection<T>,
  changes: SyncTableChangeSet,
  context: ApplyRemoteChangesContext,
): Promise<RecordsToApplyRemoteChangesTo<T>> {
  const { db } = context
  const { table } = collection

  const { deleted: deletedIds } = changes
  const deletedIdsSet = new Set(deletedIds)

  const [rawRecords, locallyDeletedIds] = await Promise.all([
    fetchRecordsForChanges(collection, changes),
    db.adapter.getDeletedRecords(table),
  ])

  return {
    ...changes,
    recordsMap: new Map(rawRecords.map((raw) => [raw.id, raw])),
    locallyDeletedIds,
    recordsToDestroy: rawRecords
      .filter((raw) => deletedIdsSet.has(raw.id))
      .map((raw) => recordFromRaw(raw, collection)),
    deletedRecordsToDestroy: locallyDeletedIds.filter((id) => deletedIdsSet.has(id)),
  }
}

async function recordsToApplyRemoteChangesTo_replacement<T extends Model>(
  collection: Collection<T>,
  changes: SyncTableChangeSet,
  context: ApplyRemoteChangesContext,
): Promise<RecordsToApplyRemoteChangesTo<T>> {
  const { db } = context
  const { table } = collection

  const queryForReplacement: Q.Where[] | null | undefined =
    context.strategy &&
    typeof context.strategy === 'object' &&
    context.strategy.experimentalQueryRecordsForReplacement
      ? context.strategy.experimentalQueryRecordsForReplacement[table]?.()
      : null

  const { created, updated, deleted: changesDeletedIds } = changes
  const deletedIdsSet = new Set(changesDeletedIds)

  const [rawRecords, locallyDeletedIds] = await Promise.all([
    unsafeFetchAsRaws(
      collection.query(
        queryForReplacement
          ? [
              Q.or(
                Q.where(columnName('id'), Q.oneOf(idsForChanges(changes))),
                Q.and(queryForReplacement),
              ),
            ]
          : [],
      ),
    ),
    db.adapter.getDeletedRecords(table),
  ])

  // HACK: We need to figure out which records deleted locally are subject to replacement, but
  // there's no officially supported way to do that, so we're using an internal API and make sure
  // we don't add these to RecordCache. Note that there could be edge cases when using join queries
  // and some of the other referenced records are also deleted.
  const replacementRecords = await (async () => {
    if (queryForReplacement) {
      const modifiedQuery = collection.query(queryForReplacement)
      modifiedQuery.description = modifiedQuery._rawDescription
      return new Set(await modifiedQuery.fetchIds())
    }
    return null
  })()

  const recordsToKeep = new Set([
    ...created.map((record) => dirtyRawId(record)),
    ...updated.map((record) => dirtyRawId(record)),
  ])

  return {
    ...changes,
    recordsMap: new Map(rawRecords.map((raw) => [raw.id, raw])),
    locallyDeletedIds,
    recordsToDestroy: rawRecords
      .filter((raw) => {
        if (deletedIdsSet.has(raw.id)) {
          return true
        }

        const subjectToReplacement = replacementRecords ? replacementRecords.has(raw.id) : true
        return subjectToReplacement && !recordsToKeep.has(raw.id) && raw._status !== 'created'
      })
      .map((raw) => recordFromRaw(raw, collection)),
    deletedRecordsToDestroy: locallyDeletedIds.filter((id) => {
      if (deletedIdsSet.has(id)) {
        return true
      }
      const subjectToReplacement = replacementRecords ? replacementRecords.has(id) : true
      return subjectToReplacement && !recordsToKeep.has(id)
    }),
  }
}

const strategyForCollection = (
  collection: { table: TableName },
  strategy: SyncPullStrategy | null | undefined,
): SyncPullStrategyType => {
  if (!strategy) {
    return 'incremental'
  } else if (typeof strategy === 'string') {
    return strategy
  }

  return strategy.override[collection.table] || strategy.default
}

async function recordsToApplyRemoteChangesTo<T extends Model>(
  collection: Collection<T>,
  changes: SyncTableChangeSet,
  context: ApplyRemoteChangesContext,
): Promise<RecordsToApplyRemoteChangesTo<T>> {
  const strategy = strategyForCollection(collection, context.strategy)
  invariant(['incremental', 'replacement'].includes(strategy), '[Sync] Invalid pull strategy')

  switch (strategy) {
    case 'replacement':
      return recordsToApplyRemoteChangesTo_replacement(collection, changes, context)
    case 'incremental':
    default:
      return recordsToApplyRemoteChangesTo_incremental(collection, changes, context)
  }
}

type AllRecordsToApply = { [tableName: TableName]: RecordsToApplyRemoteChangesTo<Model> }

const getAllRecordsToApply = (
  remoteChanges: SyncDatabaseChangeSet,
  context: ApplyRemoteChangesContext,
): Promise<AllRecordsToApply> => {
  const { db } = context
  const knownChanges = filterObj((_changes, tableName) => {
    const collection = db.get(tableName as TableName)

    if (!collection) {
      logger.warn(
        `You are trying to sync a collection named ${tableName}, but it does not exist. Will skip it (for forward-compatibility). If this is unexpected, perhaps you forgot to add it to your Database constructor's modelClasses property?`,
      )
    }

    return !!collection
  }, remoteChanges) as SyncDatabaseChangeSet

  return allPromisesObj(
    mapObj(
      (changes, tableName) =>
        recordsToApplyRemoteChangesTo(
          db.get(tableName as TableName),
          changes as SyncTableChangeSet,
          context,
        ),
      knownChanges,
    ) as Record<string, Promise<RecordsToApplyRemoteChangesTo<Model>>>,
  ) as Promise<AllRecordsToApply>
}

function validateRemoteRaw(raw: DirtyRaw): void {
  // TODO: I think other code is actually resilient enough to handle illegal _status and _changed
  // would be best to change that part to a warning - but tests are needed
  invariant(
    raw && typeof raw === 'object' && 'id' in raw && !('_status' in raw || '_changed' in raw),
    `[Sync] Invalid raw record supplied to Sync. Records must be objects, must have an 'id' field, and must NOT have a '_status' or '_changed' fields`,
  )
}

function prepareApplyRemoteChangesToCollection<T extends Model>(
  recordsToApply: RecordsToApplyRemoteChangesTo<T>,
  collection: Collection<T>,
  context: ApplyRemoteChangesContext,
): Array<T | null> {
  const { db, sendCreatedAsUpdated, log, conflictResolver } = context
  const { table } = collection
  const {
    created,
    updated,
    recordsToDestroy: deleted,
    recordsMap,
    locallyDeletedIds,
  } = recordsToApply

  // if `sendCreatedAsUpdated`, server should send all non-deleted records as `updated`
  // log error if it doesn't — but disable standard created vs updated errors
  if (sendCreatedAsUpdated && created.length) {
    logError(
      `[Sync] 'sendCreatedAsUpdated' option is enabled, and yet server sends some records as 'created'`,
    )
  }

  const recordsToBatch: Array<T | null> = [] // mutating - perf critical

  // Insert and update records
  created.forEach((raw) => {
    validateRemoteRaw(raw)
    const currentRecord = recordsMap.get(dirtyRawId(raw))
    if (currentRecord) {
      logError(
        `[Sync] Server wants client to create record ${table}#${dirtyRawId(raw)}, but it already exists locally. This may suggest last sync partially executed, and then failed; or it could be a serious bug. Will update existing record instead.`,
      )
      recordsToBatch.push(
        prepareUpdateFromRaw(currentRecord, raw, collection, log, conflictResolver),
      )
    } else if (locallyDeletedIds.includes(dirtyRawId(raw))) {
      logError(
        `[Sync] Server wants client to create record ${table}#${dirtyRawId(raw)}, but it already exists locally and is marked as deleted. This may suggest last sync partially executed, and then failed; or it could be a serious bug. Will delete local record and recreate it instead.`,
      )
      // Note: we're not awaiting the async operation (but it will always complete before the batch)
      db.adapter.destroyDeletedRecords(table, [dirtyRawId(raw)])
      recordsToBatch.push(prepareCreateFromRaw(collection, raw))
    } else {
      recordsToBatch.push(prepareCreateFromRaw(collection, raw))
    }
  })

  updated.forEach((raw) => {
    validateRemoteRaw(raw)
    const currentRecord = recordsMap.get(dirtyRawId(raw))

    if (currentRecord) {
      recordsToBatch.push(
        prepareUpdateFromRaw(currentRecord, raw, collection, log, conflictResolver),
      )
    } else if (locallyDeletedIds.includes(dirtyRawId(raw))) {
      // Nothing to do, record was locally deleted, deletion will be pushed later
    } else {
      // Record doesn't exist (but should) — just create it
      !sendCreatedAsUpdated &&
        logError(
          `[Sync] Server wants client to update record ${table}#${dirtyRawId(raw)}, but it doesn't exist locally. This could be a serious bug. Will create record instead. If this was intentional, please check the flag sendCreatedAsUpdated in https://watermelondb.dev/docs/Sync/Frontend#additional-synchronize-flags`,
        )

      recordsToBatch.push(prepareCreateFromRaw(collection, raw))
    }
  })

  deleted.forEach((record) => {
    recordsToBatch.push(record.prepareDestroyPermanently())
  })

  return recordsToBatch
}

const destroyAllDeletedRecords = async (
  db: Database,
  recordsToApply: AllRecordsToApply,
): Promise<void> => {
  const promises = toPairs(recordsToApply).map(([tableName, { deletedRecordsToDestroy }]) =>
    deletedRecordsToDestroy.length
      ? db.adapter.destroyDeletedRecords(tableName as TableName, deletedRecordsToDestroy)
      : null,
  )
  await Promise.all(promises)
}

const applyAllRemoteChanges = async (
  recordsToApply: AllRecordsToApply,
  context: ApplyRemoteChangesContext,
): Promise<void> => {
  const { db } = context
  const allRecords: Array<Model | null> = []
  toPairs(recordsToApply).forEach(([tableName, records]) => {
    prepareApplyRemoteChangesToCollection(records, db.get(tableName as TableName), context).forEach(
      (record) => {
        allRecords.push(record)
      },
    )
  })
  await db.batch(allRecords)
}

// See _unsafeBatchPerCollection - temporary fix
const unsafeApplyAllRemoteChangesByBatches = async (
  recordsToApply: AllRecordsToApply,
  context: ApplyRemoteChangesContext,
): Promise<void> => {
  const { db } = context
  const promises: Promise<void>[] = []
  toPairs(recordsToApply).forEach(([tableName, records]) => {
    const preparedModels: Array<Model | null> = prepareApplyRemoteChangesToCollection(
      records,
      db.get(tableName as TableName),
      context,
    )
    splitEvery(5000, preparedModels).forEach((recordBatch) => {
      promises.push(db.batch(recordBatch))
    })
  })
  await Promise.all(promises)
}

export default async function applyRemoteChanges(
  remoteChanges: SyncDatabaseChangeSet,
  context: ApplyRemoteChangesContext,
): Promise<void> {
  const { db, _unsafeBatchPerCollection } = context

  const recordsToApply = await getAllRecordsToApply(remoteChanges, context)

  // Perform steps concurrently
  await Promise.all([
    destroyAllDeletedRecords(db, recordsToApply),
    _unsafeBatchPerCollection
      ? unsafeApplyAllRemoteChangesByBatches(recordsToApply, context)
      : applyAllRemoteChanges(recordsToApply, context),
  ])
}
