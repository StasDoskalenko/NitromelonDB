import type Database from '../../Database'
import type { DirtyRaw } from '../../RawRecord'
import type { SyncPullArgs, SyncDatabaseChangeSet } from '../../sync'

export type InconsistentRecordInfo = {
  tableName: string
  local: DirtyRaw
  remote: DirtyRaw
  inconsistentColumns: string[]
}

export type DiagnoseSyncConsistencyOptions = {
  db: Database

  /**
   * This function should perform standard synchronization in your app (i.e. bring local database up
   * to date with server)
   */
  synchronize: () => Promise<void>

  /**
   * This function should perform a pull sync with specified arguments (similar to `pullChanges` argument
   * of `synchronize` function in your sync implementation), then return `changes` from the response
   *
   * This is used to fetch the first/full sync, to compare against local database
   */
  pullChanges: (args: SyncPullArgs) => Promise<SyncDatabaseChangeSet>

  /**
   * Optionally pass function to log messages as diagnostics are performed instead of only a bulk
   * report at the end
   */
  log?: ((message: string) => void) | undefined

  /**
   * If inconsistent record is found, `isInconsistentRecordAllowed` is consulted to determine whether
   * this inconsistency is allowed/expected (e.g. due to partial/selective syncing).
   *
   * @param local - local version of the record
   * @param remote - server version of the record
   * @param inconsistentColumns - list of column names where local and remote versions differ
   */
  isInconsistentRecordAllowed?: ((info: InconsistentRecordInfo) => Promise<boolean>) | undefined

  /**
   * If excess local record (i.e. not present in first sync) is found, `isExcessLocalRecordAllowed`
   * is consulted to determine whether this excess record is allowed/expected (e.g. due to
   * partial/selective syncing).
   */
  isExcessLocalRecordAllowed?:
    | ((info: { tableName: string; local: DirtyRaw }) => Promise<boolean>)
    | undefined

  /**
   * If missing local record (i.e. present in first sync) is found, `isMissingLocalRecordAllowed`
   * is consulted to determine whether this missing record is allowed/expected (e.g. due to
   * partial/selective syncing).
   */
  isMissingLocalRecordAllowed?:
    | ((info: { tableName: string; remote: DirtyRaw }) => Promise<boolean>)
    | undefined
}
export type SyncConsistencyDiagnosis = { issueCount: number; log: string }

export default function diagnoseSyncConsistency(
  options: DiagnoseSyncConsistencyOptions,
): Promise<SyncConsistencyDiagnosis> {
  return (
    require('./impl') as {
      default: (options: DiagnoseSyncConsistencyOptions) => Promise<SyncConsistencyDiagnosis>
    }
  ).default(options)
}
