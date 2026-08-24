import { type Observable, startWith, merge as merge$ } from '../utils/rx'
import { type Unsubscribe } from '../utils/subscriptions'
import { invariant, logger, deprecated } from '../utils/common'
import { noop, fromArrayOrSpread } from '../utils/fp'

import type { DatabaseAdapter, BatchOperation } from '../adapters/type'
import DatabaseAdapterCompat from '../adapters/compat'
import type Model from '../Model'
import type Collection from '../Collection'
import type { CollectionChangeSet, ModelClass } from '../Collection'
import type { TableName, AppSchema } from '../Schema'
import type { RawRecord } from '../RawRecord'

import CollectionMap from './CollectionMap'
import type LocalStorage from './LocalStorage'
import WorkQueue, { type ReaderInterface, type WriterInterface } from './WorkQueue'

export type DatabaseProps = {
  adapter: DatabaseAdapter
  modelClasses: ModelClass<Model>[]
  /**
   * If true, calling `database.write()` / `database.read()` (or `@writer` / `@reader`) from inside
   * an already running reader/writer, without `callWriter()` / `callReader()`, throws immediately
   * instead of deadlocking.
   *
   * Detection covers nested calls on the same JS turn and after Watermelon adapter awaits
   * (`find` / `query` / `batch`). Independent writers queued from the UI still wait as usual.
   */
  experimentalDetectNestedWriters?: boolean | undefined
}

type TableChange = [TableName, CollectionChangeSet<Model>]

let experimentalAllowsFatalError = false

export function setExperimentalAllowsFatalError(): void {
  experimentalAllowsFatalError = true
}

export default class Database {
  /**
   * Database's adapter - the low-level connection with the underlying database (e.g. SQLite)
   *
   * Unless you understand WatermelonDB's internals, you SHOULD NOT use adapter directly.
   * Running queries, or updating/deleting records on the adapter will corrupt the in-memory cache
   * if special care is not taken
   */
  adapter: DatabaseAdapterCompat

  schema: AppSchema

  collections: CollectionMap

  _workQueue: WorkQueue = new WorkQueue(this)

  /**
   * When true, nested readers/writers without callReader/callWriter throw instead of deadlocking.
   * @see {DatabaseProps#experimentalDetectNestedWriters}
   */
  experimentalDetectNestedWriters: boolean = false

  // (experimental) if true, Database is in a broken state and should not be used anymore
  _isBroken: boolean = false

  _localStorage: LocalStorage | undefined

  constructor(options: DatabaseProps) {
    const { adapter, modelClasses, experimentalDetectNestedWriters = false } = options
    if (process.env.NODE_ENV !== 'production') {
      invariant(adapter, `Missing adapter parameter for new Database()`)
      invariant(
        modelClasses && Array.isArray(modelClasses),
        `Missing modelClasses parameter for new Database()`,
      )
    }
    this.experimentalDetectNestedWriters = experimentalDetectNestedWriters
    this.adapter = new DatabaseAdapterCompat(adapter)
    this.schema = adapter.schema
    this.collections = new CollectionMap(this, modelClasses)
  }

  /**
   * Returns a `Collection` for a given table name
   */
  get<T extends Model>(tableName: TableName<T>): Collection<T> {
    return this.collections.get(tableName)
  }

  /**
   * Returns a `LocalStorage` (WatermelonDB-based localStorage/AsyncStorage alternative)
   */
  get localStorage(): LocalStorage {
    if (!this._localStorage) {
      const LocalStorageClass = (
        require('./LocalStorage') as { default: new (database: Database) => LocalStorage }
      ).default
      this._localStorage = new LocalStorageClass(this)
    }
    return this._localStorage
  }

  /**
   * Executes multiple prepared operations
   *
   * Pass a list (or array) of operations like so:
   * - `collection.prepareCreate(...)`
   * - `record.prepareUpdate(...)`
   * - `record.prepareMarkAsDeleted()` (or `record.prepareDestroyPermanently()`)
   *
   * Note that falsy values (null, undefined, false) passed to batch are simply ignored
   * so you can use patterns like `.batch(condition && record.prepareUpdate(...))` for convenience.
   *
   * Note: This method must be called within a Writer {@link Database#write}.
   */
  batch(...records: Array<Model | null | undefined | false>): Promise<void>
  batch(records: Array<Model | null | undefined | false>): Promise<void>
  batch(...args: unknown[]): Promise<void> {
    return this._workQueue.followPromise(this._performBatch(args))
  }

  async _performBatch(args: unknown[]): Promise<void> {
    const actualRecords = fromArrayOrSpread<Model | null | undefined | false>(
      args,
      'Database.batch',
      'Model',
    )

    this._ensureInWriter(`Database.batch()`)

    // performance critical - using mutations
    const batchOperations: BatchOperation[] = []
    const changeNotifications: { [tableName: TableName]: CollectionChangeSet<Model> } = {}
    actualRecords.forEach((record) => {
      if (!record) {
        return
      }

      const preparedState = record._preparedState
      if (!preparedState) {
        invariant(record._raw._status !== 'disposable', `Cannot batch a disposable record`)
        throw new Error(`Cannot batch a record that doesn't have a prepared create/update/delete`)
      }

      const raw = record._raw
      const { id } = raw // faster than Model.id
      const { table } = record.constructor as typeof Model // faster than Model.table

      let changeType: CollectionChangeSet<Model>[number]['type']

      if (preparedState === 'update') {
        batchOperations.push(['update', table, raw])
        changeType = 'updated'
      } else if (preparedState === 'create') {
        batchOperations.push(['create', table, raw])
        changeType = 'created'
      } else if (preparedState === 'markAsDeleted') {
        batchOperations.push(['markAsDeleted', table, id])
        changeType = 'destroyed'
      } else if (preparedState === 'destroyPermanently') {
        batchOperations.push(['destroyPermanently', table, id])
        changeType = 'destroyed'
      } else {
        invariant(false, 'bad preparedState')
      }

      if (preparedState !== 'create') {
        // We're (unsafely) assuming that batch will succeed and removing the "pending" state so that
        // subsequent changes to the record don't trip up the invariant
        // TODO: What if this fails?
        record._preparedState = null
      }

      if (!changeNotifications[table]) {
        changeNotifications[table] = []
      }
      changeNotifications[table].push({ record, type: changeType })
    })

    await this.adapter.batch(batchOperations)

    // Debug info
    if (this.experimentalIsVerbose) {
      const debugInfo = batchOperations
        .map(([type, table, rawOrId]) => {
          switch (type) {
            case 'create':
            case 'update':
              return `${type} ${table}#${(rawOrId as RawRecord).id}`
            case 'markAsDeleted':
            case 'destroyPermanently':
              return `${type} ${table}#${rawOrId}`
            default:
              return `${type}???`
          }
        })
        .join(', ')
      logger.debug(`batch: ${debugInfo}`)
    }

    // NOTE: We must make two passes to ensure all changes to caches are applied before subscribers are called
    const changes = Object.entries(changeNotifications) as TableChange[]

    changes.forEach(([table, changeSet]) => {
      this.collections.get(table)._applyChangesToCache(changeSet)
    })

    this._notify(changes)

    return undefined // shuts up flow
  }

  _pendingNotificationBatches: number = 0
  _pendingNotificationChanges: TableChange[][] = []

  _notify(changes: TableChange[]): void {
    if (this._pendingNotificationBatches > 0) {
      this._pendingNotificationChanges.push(changes)
      return
    }

    const affectedTables = new Set(changes.map(([table]) => table))

    const databaseChangeNotifySubscribers = ([tables, subscriber]: [
      TableName[],
      () => void,
      unknown,
    ]): void => {
      if (tables.some((table) => affectedTables.has(table))) {
        subscriber()
      }
    }
    this._subscribers.forEach(databaseChangeNotifySubscribers)

    changes.forEach(([table, changeSet]) => {
      this.collections.get(table)._notify(changeSet)
    })
  }

  async experimentalBatchNotifications<T>(work: () => Promise<T>): Promise<T> {
    // TODO: Document & add tests if this proves useful
    try {
      this._pendingNotificationBatches += 1
      const result = await work()
      return result
    } finally {
      this._pendingNotificationBatches -= 1
      if (this._pendingNotificationBatches === 0) {
        const changes = this._pendingNotificationChanges
        this._pendingNotificationChanges = []
        changes.forEach((_changes) => this._notify(_changes))
      }
    }
  }

  /**
   * Schedules a Writer
   *
   * Writer is a block of code, inside of which you can modify the database
   * (call `Collection.create`, `Model.update`, `Database.batch` and so on).
   *
   * In a Writer, you're guaranteed that no other Writer is simultaneously executing. Therefore, you
   * can rely on the results of queries and other asynchronous operations - they won't change for
   * the duration of this Writer (except if changed by it).
   *
   * To call another Writer (or Reader) from this one without deadlocking, use `callWriter`
   * (or `callReader`). If {@link DatabaseProps#experimentalDetectNestedWriters} is enabled, a nested write
   * without `callWriter` throws instead of hanging forever.
   *
   * See docs for more details and a practical guide.
   *
   * @param work - Block of code to execute
   * @param [description] - Debug description of this Writer
   */
  write<T>(work: (writer: WriterInterface) => Promise<T>, description?: string): Promise<T> {
    return this._workQueue.enqueue(work, description, true)
  }

  /**
   * Schedules a Reader
   *
   * In a Reader, you're guaranteed that no Writer is running at the same time. Therefore, you can
   * run many queries or other asynchronous operations, and you can rely on their results - they
   * won't change for the duration of this Reader. However, other Readers might run concurrently.
   *
   * To call another Reader from this one, use `callReader`
   *
   * See docs for more details and a practical guide.
   *
   * @param work - Block of code to execute
   * @param [description] - Debug description of this Reader
   */
  read<T>(work: (reader: ReaderInterface) => Promise<T>, description?: string): Promise<T> {
    return this._workQueue.enqueue(work, description, false)
  }

  /**
   * @deprecated Use {@link Database#write} instead.
   */
  action<T>(work: (writer: WriterInterface) => Promise<T>, description?: string): Promise<T> {
    if (process.env.NODE_ENV !== 'production') {
      deprecated('Database.action()', 'Use Database.write() instead.')
    }
    return this._workQueue.enqueue(work, `${description || 'unnamed'} (legacy action)`, true)
  }

  /**
   * Returns an `Observable` that emits a signal (`null`) immediately, and on every change in
   * any of the passed tables.
   *
   * A set of changes made is passed with the signal, with an array of changes per-table
   * (Currently, if changes are made to multiple different tables, multiple signals will be emitted,
   * even if they're made with a batch. However, this behavior might change. Use Rx to debounce,
   * throttle, merge as appropriate for your use case.)
   *
   * Warning: You can easily introduce performance bugs in your application by using this method
   * inappropriately.
   */
  withChangesForTables(tables: TableName[]): Observable<CollectionChangeSet<Model> | null> {
    const changesSignals = tables.map((table) => this.collections.get(table).changes)

    return merge$(...changesSignals).pipe(startWith(null))
  }

  _subscribers: [TableName[], () => void, unknown][] = []

  /**
   * Notifies `subscriber` on change in any of the passed tables.
   *
   * A single notification will be sent per `database.batch()` call.
   * (Currently, no details about the changes made are provided, only a signal, but this behavior
   * might change. Currently, subscribers are called before `withChangesForTables`).
   *
   * Warning: You can easily introduce performance bugs in your application by using this method
   * inappropriately.
   */
  experimentalSubscribe(
    tables: TableName[],
    subscriber: () => void,
    debugInfo?: unknown,
  ): Unsubscribe {
    if (!tables.length) {
      return noop
    }

    const entry: [TableName[], () => void, unknown] = [tables, subscriber, debugInfo]
    this._subscribers.push(entry)

    return () => {
      const idx = this._subscribers.indexOf(entry)
      idx !== -1 && this._subscribers.splice(idx, 1)
    }
  }

  _resetCount: number = 0

  _isBeingReset: boolean = false

  /**
   * Resets the database
   *
   * This permanently deletes the database (all records, metadata, and `LocalStorage`) and sets
   * up an empty database.
   *
   * Special care must be taken to safely reset the database. Ideally, you should reset your app
   * to an empty / "logging out" state while doing this. Specifically:
   *
   * - You MUST NOT hold onto Watermelon records other than this `Database`. Do not keep references
   *   to records, collections, or any other objects from before database reset
   * - You MUST NOT observe any Watermelon state. All Database, Collection, Query, and Model
   *   observers/subscribers should be disposed of before resetting
   * - You SHOULD NOT have any pending (queued) Readers or Writers. Pending work will be aborted
   *   (rejected with an error)
   */
  async unsafeResetDatabase(): Promise<void> {
    this._ensureInWriter(`Database.unsafeResetDatabase()`)
    try {
      this._isBeingReset = true
      // First kill actions, to ensure no more traffic to adapter happens
      this._workQueue._abortPendingWork()

      // Kill ability to call adapter methods during reset (to catch bugs if someone does this)
      const { adapter } = this
      const ErrorAdapter = (
        require('../adapters/error') as { default: new () => DatabaseAdapterCompat }
      ).default
      this.adapter = new ErrorAdapter()

      // Check for illegal subscribers
      if (this._subscribers.length) {
        // TODO: This should be an error, not a console.log, but actually useful diagnostics are necessary for this to work, otherwise people will be confused
        // eslint-disable-next-line no-console
        console.log(
          `Application error! Unexpected ${this._subscribers.length} Database subscribers were detected during database.unsafeResetDatabase() call. App should not hold onto subscriptions or Watermelon objects while resetting database.`,
        )
        // eslint-disable-next-line no-console
        console.log(this._subscribers)
        this._subscribers = []
      }

      // Clear the database
      await adapter.unsafeResetDatabase()

      // Only now clear caches, since there may have been queued fetches from DB still bringing in items to cache
      Object.values(this.collections.map).forEach((collection) => {
        collection._cache.unsafeClear()
      })

      // Restore working Database
      this._resetCount += 1
      this.adapter = adapter

      // Belt-and-suspenders: per the contract above, no subscription should
      // still be active at this point. If one is anyway (an app bug -- e.g.
      // a persistent top-level component that stayed mounted across a
      // logout/login), its Query's cached SharedSubscribable(s) would
      // otherwise keep serving their last (pre-reset / other user's)
      // emission forever, since nothing else would tell them the underlying
      // data changed. Force those (and only those -- idle Query caches are
      // untouched) to drop their stale value and refetch against the
      // now-reset database.
      this.resetObservablesCache()
    } finally {
      this._isBeingReset = false
    }
  }

  /**
   * Forces every actively-subscribed `Query` observer on every `Collection`
   * (`.observe()`, `.observeWithColumns()`, `.observeCount()`, and their
   * Rx-free `experimentalSubscribe*()` equivalents) to drop its cached last
   * emission and immediately re-fetch.
   *
   * `unsafeResetDatabase()` already calls this for you. Call it yourself
   * after mutating the database *outside* of Watermelon's write path --
   * most commonly raw SQL/adapter access via `database.adapter.unsafeExecute()`
   * (see [Advanced: Unsafe raw execute](https://stasdoskalenko.github.io/NitromelonDB/docs/CRUD#advanced-unsafe-raw-execute))
   * or a manual "delete everything from every table" logout that doesn't go
   * through `unsafeResetDatabase()`. Without calling this afterward, any
   * already-subscribed Query would keep serving whatever it last saw before
   * your raw write, unaware anything changed.
   *
   * Safe to call even when nothing needs invalidating (idle Query caches --
   * ones with no current subscriber -- are left untouched either way, so
   * calling this too often just costs a few no-op checks, not correctness).
   *
   * Must be called from inside a Writer.
   */
  resetObservablesCache(): void {
    this._ensureInWriter(`Database.resetObservablesCache()`)
    Object.values(this.collections.map).forEach((collection) => {
      collection.resetObservablesCache()
    })
  }

  // (experimental) if true, Models will print to console diagnostic information on every
  // prepareCreate/Update/Delete call, as well as on commit (Database.batch() call). Note that this
  // has a significant performance impact so should only be enabled when debugging.
  experimentalIsVerbose: boolean = false

  _ensureInWriter(debugName: string): void {
    invariant(
      this._workQueue.isWriterRunning,
      `${debugName} can only be called from inside of a Writer. See docs for more details.`,
    )
  }

  // (experimental) puts Database in a broken state
  // TODO: Not used anywhere yet
  _fatalError(error: Error): void {
    if (!experimentalAllowsFatalError) {
      logger.warn(
        'Database is now broken, but experimentalAllowsFatalError has not been enabled to do anything about it...',
      )
      return
    }

    this._isBroken = true
    logger.error('Database is broken. App must be reloaded before continuing.')

    // TODO: Passing this to an adapter feels wrong, but it's tricky.
    const underlying = this.adapter.underlyingAdapter as DatabaseAdapter & {
      _fatalError?: (fatalError: Error) => void
    }
    if (underlying._fatalError) {
      underlying._fatalError(error)
    }
  }
}
