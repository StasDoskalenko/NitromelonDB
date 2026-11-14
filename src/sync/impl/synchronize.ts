import { invariant, logger } from '../../utils/common'

import {
  applyRemoteChanges,
  fetchLocalChanges,
  markLocalChangesAsSynced,
  getLastPulledAt,
  setLastPulledAt,
  setLastPulledSchemaVersion,
  getMigrationInfo,
  getSavedPullCursor,
  parseSavedPullCursor,
  serializePullCursor,
  setSavedPullCursor,
  removeSavedPullCursor,
} from './index'
import { ensureSameDatabase, isChangeSetEmpty, changeSetCount } from './helpers'
import type {
  SyncArgs,
  Timestamp,
  SyncPullStrategy,
  SyncPullResult,
  SyncPullCursor,
} from '../index'

function isChangesResult(
  result: SyncPullResult,
): result is Extract<SyncPullResult, { changes: unknown; timestamp: Timestamp }> {
  return 'changes' in result
}

// Only a string, number, object or array is a cursor for the next page. Anything else (null, a
// missing field, false, '') means this is the last page, so a server or pullChanges() that already
// returned some other `nextCursor` value before paginated pulls existed keeps working as before.
function asCursor(value: unknown): SyncPullCursor | null {
  if (typeof value === 'string') {
    return value === '' ? null : value
  }
  if (typeof value === 'number' || (typeof value === 'object' && value !== null)) {
    return value as SyncPullCursor
  }
  return null
}

function usesReplacement(strategy: SyncPullStrategy | undefined): boolean {
  if (!strategy) {
    return false
  }
  if (typeof strategy === 'string') {
    return strategy === 'replacement'
  }
  return (
    strategy.default === 'replacement' ||
    Object.values(strategy.override).some((type) => type === 'replacement')
  )
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
  // A paginated pull an earlier sync didn't finish is saved too (read at the same time, not to add a
  // round trip to every sync)
  const [lastPulledAt, initialSavedCursor] = await Promise.all([
    getLastPulledAt(database),
    getSavedPullCursor(database),
  ])
  log && (log.lastPulledAt = lastPulledAt)

  const { schemaVersion, migration, shouldSaveSchemaVersion } = await getMigrationInfo(
    database,
    log,
    lastPulledAt,
    migrationsEnabledAtVersion,
  )
  log && (log.phase = 'ready to pull')

  // It continues where it stopped, unless something it depends on changed since (lastPulledAt, or
  // the schema after an app update)
  let savedCursor = initialSavedCursor
  const resumable = parseSavedPullCursor(savedCursor)
  let cursor: SyncPullCursor | null =
    resumable &&
    resumable.lastPulledAt === (lastPulledAt ?? null) &&
    resumable.schemaVersion === schemaVersion
      ? resumable.cursor
      : null
  log && (log.resumedPullCursor = cursor !== null)

  let newLastPulledAt: Timestamp | undefined
  let pageCount = 0
  let totalRemoteChangeCount = 0

  for (;;) {
    const pullResult = await pullChanges({
      lastPulledAt,
      schemaVersion,
      migration,
      ...(cursor !== null ? { cursor } : {}),
    })
    pageCount += 1
    log && (log.pulledPages = pageCount)
    log && (log.phase = 'pulled')

    const nextCursor = isChangesResult(pullResult) ? asCursor(pullResult.nextCursor) : null
    if (
      process.env.NODE_ENV !== 'production' &&
      nextCursor === null &&
      (pullResult as { experimentalHasMore?: unknown }).experimentalHasMore === true
    ) {
      // The flag of a WatermelonDB pull request (Nozbe/WatermelonDB#1965) that was never released.
      // It's ignored: the rest of the changes come with the next sync, starting at this timestamp.
      logger.warn(
        '[Sync] pullChanges() returned experimentalHasMore, which NitromelonDB does not support. Only this page was pulled. Return nextCursor for paginated pulls instead (see Sync / Frontend, Paginated pulls)',
      )
    }
    const isLastPage = nextCursor === null
    const isPaginated = !isLastPage || pageCount > 1 || cursor !== null
    if (!isLastPage) {
      invariant(
        JSON.stringify(nextCursor) !== JSON.stringify(cursor),
        '[Sync] pullChanges() returned the same nextCursor it was called with. It would never finish',
      )
    }

    let pageTimestamp: Timestamp | undefined = isChangesResult(pullResult)
      ? pullResult.timestamp
      : undefined
    const remoteChangeCount = isChangesResult(pullResult) ? changeSetCount(pullResult.changes) : NaN
    totalRemoteChangeCount += remoteChangeCount

    if (onWillApplyRemoteChanges) {
      await onWillApplyRemoteChanges({ remoteChangeCount })
    }

    const nextSavedCursor = isLastPage
      ? null
      : serializePullCursor({
          lastPulledAt: lastPulledAt ?? null,
          schemaVersion,
          cursor: nextCursor,
        })

    await database.write(async () => {
      ensureSameDatabase(database, resetCount)
      invariant(
        lastPulledAt === (await getLastPulledAt(database)),
        '[Sync] Concurrent synchronization is not allowed. More than one synchronize() call was running at the same time, and the later one was aborted before committing results to local database.',
      )
      if (isPaginated) {
        // Another sync that saved its own cursor in the meantime is pulling the same pages
        invariant(
          savedCursor === (await getSavedPullCursor(database)),
          '[Sync] Concurrent synchronization is not allowed. More than one synchronize() call was pulling pages at the same time, and the later one was aborted before committing results to local database.',
        )
      }

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
        invariant(!isPaginated, 'unsafeTurbo can not be used with a paginated pull')

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
        pageTimestamp = resultRest.timestamp
        onDidPullChanges && onDidPullChanges(resultRest)
      }

      invariant(
        typeof pageTimestamp === 'number' && pageTimestamp > 0,
        `pullChanges() returned invalid timestamp ${String(pageTimestamp)}. timestamp must be a non-zero number`,
      )

      if (!unsafeTurbo) {
        invariant(
          isChangesResult(pullResult),
          'pullChanges() must return changes unless unsafeTurbo',
        )
        const { changes: remoteChanges, ...resultRest } = pullResult
        log && (log.remoteChangeCount = totalRemoteChangeCount)
        const experimentalStrategy: SyncPullStrategy | undefined = pullResult.experimentalStrategy
        invariant(
          !isPaginated || !usesReplacement(experimentalStrategy),
          '[Sync] A replacement strategy can not be used with a paginated pull: each page would delete the records of the others',
        )
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

      if (isLastPage) {
        newLastPulledAt = pageTimestamp
        log && (log.newLastPulledAt = newLastPulledAt)
        log && (log.phase = 'applied remote changes')
        await setLastPulledAt(database, newLastPulledAt)

        if (shouldSaveSchemaVersion) {
          await setLastPulledSchemaVersion(database, schemaVersion)
        }
        if (savedCursor !== null) {
          await removeSavedPullCursor(database)
        }
      } else {
        log && (log.phase = 'applied a page of remote changes')
        await setSavedPullCursor(database, nextSavedCursor as string)
      }
    }, 'sync-synchronize-apply')

    if (isLastPage) {
      break
    }
    savedCursor = nextSavedCursor
    cursor = nextCursor
  }

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
