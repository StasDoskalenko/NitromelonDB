import { invariant } from '../../utils/common'

import {
  applyRemoteChanges,
  fetchLocalChanges,
  markLocalChangesAsSynced,
  getLastPulledAt,
  setLastPulledAt,
  setLastPulledSchemaVersion,
  getMigrationInfo,
} from './index'
import { ensureSameDatabase, isChangeSetEmpty, changeSetCount } from './helpers'
import type { SyncArgs, Timestamp, SyncPullStrategy, SyncPullResult } from '../index'

function isChangesResult(
  result: SyncPullResult,
): result is Extract<SyncPullResult, { changes: unknown; timestamp: Timestamp }> {
  return 'changes' in result
}

function isTurboJsonResult(result: SyncPullResult): result is { syncJson: string } {
  return 'syncJson' in result
}

function isTurboJsonIdResult(result: SyncPullResult): result is { syncJsonId: number } {
  return 'syncJsonId' in result
}

export default async function synchronize({
  database,
  pullChanges,
  onWillApplyRemoteChanges,
  onDidPullChanges,
  pushChanges,
  sendCreatedAsUpdated = false,
  migrationsEnabledAtVersion,
  log,
  conflictResolver,
  _unsafeBatchPerCollection,
  unsafeTurbo,
}: SyncArgs): Promise<void> {
  const resetCount = database._resetCount
  log && (log.startedAt = new Date())
  log && (log.phase = 'starting')

  // TODO: Wrap the three computionally intensive phases in `requestIdleCallback`

  // pull phase
  const lastPulledAt = await getLastPulledAt(database)
  log && (log.lastPulledAt = lastPulledAt)

  const { schemaVersion, migration, shouldSaveSchemaVersion } = await getMigrationInfo(
    database,
    log,
    lastPulledAt,
    migrationsEnabledAtVersion,
  )
  log && (log.phase = 'ready to pull')

  const pullResult = await pullChanges({
    lastPulledAt,
    schemaVersion,
    migration,
  })
  log && (log.phase = 'pulled')

  let newLastPulledAt: Timestamp | undefined = isChangesResult(pullResult)
    ? pullResult.timestamp
    : undefined
  const remoteChangeCount = isChangesResult(pullResult) ? changeSetCount(pullResult.changes) : NaN

  if (onWillApplyRemoteChanges) {
    await onWillApplyRemoteChanges({ remoteChangeCount })
  }

  await database.write(async () => {
    ensureSameDatabase(database, resetCount)
    invariant(
      lastPulledAt === (await getLastPulledAt(database)),
      '[Sync] Concurrent synchronization is not allowed. More than one synchronize() call was running at the same time, and the later one was aborted before committing results to local database.',
    )

    if (unsafeTurbo) {
      invariant(
        !_unsafeBatchPerCollection,
        'unsafeTurbo must not be used with _unsafeBatchPerCollection',
      )
      invariant(
        isTurboJsonResult(pullResult) || isTurboJsonIdResult(pullResult),
        'missing syncJson/syncJsonId',
      )
      invariant(lastPulledAt === null, 'unsafeTurbo can only be used as the first sync')

      const syncJsonId = isTurboJsonIdResult(pullResult)
        ? pullResult.syncJsonId
        : Math.floor(Math.random() * 1000000000)

      if (isTurboJsonResult(pullResult)) {
        await database.adapter.provideSyncJson(syncJsonId, pullResult.syncJson)
      }

      const resultRest = (await database.adapter.unsafeLoadFromSync(syncJsonId)) as {
        timestamp?: Timestamp
        [key: string]: unknown
      }
      newLastPulledAt = resultRest.timestamp
      onDidPullChanges && onDidPullChanges(resultRest)
    }

    log && (log.newLastPulledAt = newLastPulledAt)
    invariant(
      typeof newLastPulledAt === 'number' && newLastPulledAt > 0,
      `pullChanges() returned invalid timestamp ${String(newLastPulledAt)}. timestamp must be a non-zero number`,
    )

    if (!unsafeTurbo) {
      invariant(isChangesResult(pullResult), 'pullChanges() must return changes unless unsafeTurbo')
      const { changes: remoteChanges, ...resultRest } = pullResult
      log && (log.remoteChangeCount = remoteChangeCount)
      const experimentalStrategy: SyncPullStrategy | undefined = pullResult.experimentalStrategy
      await applyRemoteChanges(remoteChanges, {
        db: database,
        strategy: experimentalStrategy,
        sendCreatedAsUpdated,
        log,
        conflictResolver,
        _unsafeBatchPerCollection,
      })
      onDidPullChanges && onDidPullChanges(resultRest)
    }

    log && (log.phase = 'applied remote changes')
    await setLastPulledAt(database, newLastPulledAt)

    if (shouldSaveSchemaVersion) {
      await setLastPulledSchemaVersion(database, schemaVersion)
    }
  }, 'sync-synchronize-apply')

  // push phase
  if (pushChanges) {
    log && (log.phase = 'ready to fetch local changes')

    const localChanges = await fetchLocalChanges(database)
    log && (log.localChangeCount = changeSetCount(localChanges.changes))
    log && (log.phase = 'fetched local changes')

    ensureSameDatabase(database, resetCount)
    if (!isChangeSetEmpty(localChanges.changes)) {
      log && (log.phase = 'ready to push')
      const pushResult =
        (await pushChanges({
          changes: localChanges.changes,
          lastPulledAt: newLastPulledAt as Timestamp,
        })) || {}
      log && (log.phase = 'pushed')
      log && (log.rejectedIds = pushResult.experimentalRejectedIds)

      ensureSameDatabase(database, resetCount)
      await markLocalChangesAsSynced(database, localChanges, pushResult.experimentalRejectedIds)
      log && (log.phase = 'marked local changes as synced')
    }
  } else {
    log && (log.phase = 'pushChanges not defined')
  }

  log && (log.finishedAt = new Date())
  log && (log.phase = 'done')
}
