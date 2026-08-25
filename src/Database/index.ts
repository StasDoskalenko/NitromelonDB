import { type Observable, startWith, merge as merge$ } from '../utils/rx'
import { type Unsubscribe } from '../utils/subscriptions'
import { invariant, logger, deprecated } from '../utils/common'
import { noop, fromArrayOrSpread } from '../utils/fp'

import type { DatabaseAdapter, BatchOperation } from '../adapters/type'
import DatabaseAdapterCompat from '../adapters/compat'
import type Model from '../Model'
import type Collection from '../Collection'
import type { CollectionChangeSet, ModelClass } from '../Collection'
import type { TableName, AppSchema, SchemaVersion } from '../Schema'
import type { RawRecord } from '../RawRecord'

import CollectionMap from './CollectionMap'
import type LocalStorage from './LocalStorage'
import type { DatabaseSeed } from './seed'
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
  /**
   * Seeds the database with initial/demo data, built with `databaseSeed()` (see
   * `nitromelondb/Database/seed`) -- an array of `{ schemaVersion, run }` steps, deliberately
   * kept separate from schema migrations (see schemaMigrations()) rather than folded into them:
   * migrations are synchronous, declarative SQL with no room for arbitrary JS/IO; a step's `run`
   * can freely be async (`await fetch(...)`, read a file, etc).
   *
   * Each step is tied to the schema version it was written against -- the same way a migration's
   * `toVersion` is -- instead of an independent counter you have to remember to bump yourself. A
   * step only runs once the database has actually reached its `schemaVersion` (immediately, for
   * a fresh install already on the latest schema; after migrating, for an existing install
   * catching up), and only once ever per step -- applied steps are tracked durably (internally,
   * the same way sync tracks its own bookkeeping), not by `run` querying its own table to guess
   * whether it already ran (that would mean deciding based on data that might itself still be
   * mid-write, and would require `run` to read a table it might have no other reason to touch).
   * If `run` throws, that step (and every step after it) is retried on the next launch; steps
   * that already succeeded are not re-run.
   *
   * Runs after schema setup/migrations finish (if the adapter exposes an `initializingPromise`
   * -- e.g. SQLiteAdapter -- that's awaited first). Every write()/read()/batch() call, and every
   * direct Collection/Query read (find(), query().fetch(), query().fetchCount(),
   * observe*()/experimentalSubscribe*(), etc.) issued after `new Database()` is queued until
   * every pending step resolves (or there are none) -- so app code never needs to guard against
   * seeding itself the way ad-hoc "seed in a data hook" patterns had to. In development, an
   * access that has to wait logs a warning once per Database instance, since it usually means
   * something (a module-level singleton, a reader/writer that fires as soon as the app starts)
   * is touching the database earlier than intended. See also `Database#readyPromise`.
   *
   * Inside a step's `run`, use `database.batch()` / `collection.prepareCreate()` directly, not
   * `database.write()` -- calling write() from inside the writer that's already running (which
   * is what seeding executes as) deadlocks, same as any nested writer without callWriter(). If
   * `run` also needs to read via the normal query API for some reason (rare -- the "did this
   * already happen" case is handled for you), that's safe too: reads issued from inside `run`
   * proceed immediately rather than waiting on seeding to finish, since that's exactly what's
   * currently executing. A completely unrelated read that happens to fire while a step is
   * mid-flight gets the same treatment (sees in-progress data, doesn't wait) -- an accepted
   * tradeoff shared with any other in-progress write, not something specific to seeding.
   *
   * If a step's `run` throws, `onError` is called (mirroring SQLiteAdapterOptions#onSetUpError,
   * with which step failed) and that step's version is NOT marked applied, so it (and any step
   * after it) is retried next launch. The database does NOT get stuck either way: queued/gated
   * calls are released once the current step settles, whether it succeeded or not, so a broken
   * step degrades to "database usable, just not (fully) seeded" rather than every read/write
   * hanging forever.
   */
  seed?: DatabaseSeed | undefined
}

// Deliberately not ModelClass<T>: that type's own static methods reference Collection<Record>,
// which makes it impossible for TS to *infer* T from a concrete class passed at a call site
// (e.g. `database.get(Note)`) — the inference only resolves down to `T = Model`, even though
// an explicit `database.get<Note>(Note)` type-checks fine. This minimal shape (a constructor
// returning T, plus the one field get() actually reads) is exactly what inference needs and
// nothing more.
type ModelClassRef<T extends Model> = { new (...args: never[]): T; table: TableName<T> }

type TableChange = [TableName, CollectionChangeSet<Model>]

// Tracks the last-applied DatabaseProps#seed schema version, the same way sync's own
// lastPulledSchemaVersionKey (src/sync/impl/index.ts) tracks its bookkeeping: directly via
// adapter.getLocal/setLocal (a plain string, parsed with parseInt), not the public,
// JSON-wrapping Database#localStorage -- that's app-facing storage, this is internal
// (library-owned) metadata, same distinction sync's own local keys already make.
const SEED_VERSION_KEY = '__nitromelon_seed_version'

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

  // True once every pending `seed` step (see DatabaseProps#seed) has settled (run, skipped as
  // already-applied, or stopped at a failing step), or immediately if no `seed` was configured
  // at all -- the common case, kept branch-free so unrelated consumers pay nothing.
  _ready: boolean = true

  _readyPromise: Promise<void> = Promise.resolve()

  // Resolves once the adapter's own init/migration barrier (if it exposes one) is done --
  // computed once here so both _runSeed and the public readyPromise getter share it, instead of
  // each re-deriving it from `adapter`.
  _adapterInitPromise: Promise<void> = Promise.resolve()

  // True for the entire duration a seed step's `run` is executing (including across any awaits
  // inside it) -- lets a read `run` triggers on itself proceed immediately instead of waiting on
  // _readyPromise, which wouldn't resolve until seeding itself finishes. This is now rarely
  // needed in practice (the common "did this already happen" check is handled by the durable,
  // per-step version marker below, not by `run` querying its own table), but stays as a narrow
  // safety net for `run` implementations that read via the query API for some other reason. A
  // read that happens to come from unrelated code while a step is still executing gets the same
  // treatment (sees in-progress data rather than being queued) -- an accepted tradeoff shared
  // with any other in-progress write, not something specific to seeding.
  _seeding: boolean = false

  _readyWarned: boolean = false

  // Kept around (not just used once in the constructor) so unsafeResetDatabase() can reapply it
  // -- see there for why.
  _seed: DatabaseSeed | undefined

  constructor(options: DatabaseProps) {
    const { adapter, modelClasses, experimentalDetectNestedWriters = false, seed } = options
    if (process.env.NODE_ENV !== 'production') {
      invariant(adapter, `Missing adapter parameter for new Database()`)
      invariant(
        modelClasses && Array.isArray(modelClasses),
        `Missing modelClasses parameter for new Database()`,
      )
      if (seed) {
        const maxSeedVersion = seed.sortedSteps[seed.sortedSteps.length - 1]?.schemaVersion ?? 0
        invariant(
          maxSeedVersion <= adapter.schema.version,
          `Seed step targets schema version ${maxSeedVersion}, but schema is only at version ` +
            `${adapter.schema.version}. A seed step can't target a schema version the app` +
            `'s own schema hasn't reached yet.`,
        )
      }
    }
    this.experimentalDetectNestedWriters = experimentalDetectNestedWriters
    this.adapter = new DatabaseAdapterCompat(adapter)
    this.schema = adapter.schema
    this.collections = new CollectionMap(this, modelClasses)

    const initializingPromise = (adapter as { initializingPromise?: unknown }).initializingPromise
    this._adapterInitPromise =
      initializingPromise instanceof Promise ? initializingPromise : this._adapterInitPromise

    this._seed = seed

    if (seed) {
      this._ready = false
      // Runs as writer job #0 in the WorkQueue (enqueued synchronously, before this constructor
      // returns) so every write()/read()/batch() issued afterwards is naturally queued behind it
      // by ordinary FIFO ordering -- no separate gating needed for those. database.batch() inside
      // a step's run() works the same way it would inside any other writer, since this job IS
      // the running writer for the whole time any step is executing.
      this._readyPromise = this._workQueue
        .enqueue(() => this._runSeed(seed), 'Database.seed', true)
        .then(() => {
          this._ready = true
        })
    }
  }

  /**
   * Resolves once schema setup/migrations (if the adapter exposes one -- e.g. SQLiteAdapter's
   * `initializingPromise`) and every pending `seed` step (if configured) have settled. Purely
   * observational -- every read/write already queues correctly without this (see
   * DatabaseProps#seed) -- use it to gate your OWN bootstrap UI (e.g. a splash screen) on
   * readiness explicitly, if you want to, instead of just letting reads/writes queue silently
   * underneath while your UI renders as if the database were already usable.
   */
  get readyPromise(): Promise<void> {
    return this._adapterInitPromise.then(() => this._readyPromise)
  }

  /**
   * Synchronous snapshot of whether `readyPromise` has already resolved -- `false` while any
   * pending `seed` step is still running (deliberately: this is the "should my UI still show a
   * splash screen" question, not the narrower "is it safe for a raw read to proceed without
   * queuing" one `_readsUnblocked` below answers -- those give different answers *during* a
   * step's own execution, on purpose). Reading this once at mount, then `readyPromise.then(...)`
   * for the transition, is exactly what `useDatabaseReady()` (`nitromelondb/hooks`) does.
   */
  get isReady(): boolean {
    return this._ready
  }

  // Never rejects -- a failing step is reported via seed.onError (or logged) and the database
  // still becomes usable (just not marked as seeded past that step, so it's retried next
  // launch). _readyPromise gates every read/write on this resolving; if it could reject, that
  // rejection would go unhandled at every one of those call sites, since none of them are in a
  // position to catch it individually.
  async _runSeed(seed: DatabaseSeed): Promise<void> {
    // Seed always runs after migrations, never interleaved with or ahead of them.
    await this._adapterInitPromise

    let appliedVersion = 0
    try {
      appliedVersion = parseInt((await this.adapter.getLocal(SEED_VERSION_KEY)) ?? '', 10) || 0
    } catch (error) {
      this._reportSeedError(seed, error, 0)
      return
    }

    const pendingSteps = seed.sortedSteps.filter((step) => step.schemaVersion > appliedVersion)

    for (const step of pendingSteps) {
      this._seeding = true
      try {
        await step.run(this)
      } catch (error) {
        this._reportSeedError(seed, error, step.schemaVersion)
        return
      } finally {
        this._seeding = false
      }

      try {
        await this.adapter.setLocal(SEED_VERSION_KEY, `${step.schemaVersion}`)
      } catch (error) {
        this._reportSeedError(seed, error, step.schemaVersion)
        return
      }
    }
  }

  _reportSeedError(
    seed: {
      onError?: ((error: unknown, context: { schemaVersion: SchemaVersion }) => void) | undefined
    },
    error: unknown,
    schemaVersion: SchemaVersion,
  ): void {
    if (seed.onError) {
      seed.onError(error, { schemaVersion })
    } else if (process.env.NODE_ENV !== 'production') {
      logger.error(
        `[Database] seed step for schema version ${schemaVersion} failed -- database will ` +
          'proceed with seeding incomplete',
        error,
      )
    }
  }

  // NOT the same question `isReady` (above) answers -- deliberately also true while a seed step
  // is actively running (_seeding), so that step's own reads (and any unrelated read that
  // happens to fire during that window) proceed immediately instead of deadlocking on
  // _readyPromise, which wouldn't resolve until the step itself returns. `isReady` is "should my
  // UI treat the database as ready"; this is "can a raw read skip the queue right now" -- they
  // agree once seeding fully settles, and disagree for the (usually brief) window while it's
  // still running.
  //
  // Cheap (no allocation) fast-path check -- callers on a hot path (Collection's raw-read
  // methods) test this FIRST and only build the closure _whenReady() needs when it's false, so
  // the overwhelmingly common case (already unblocked) never allocates one at all.
  get _readsUnblocked(): boolean {
    return this._ready || this._seeding
  }

  // Runs `fn` immediately if reads are unblocked (the common-case fast path -- no promise
  // overhead at all), or once `seed` has been resolved (run, or skipped as already-applied)
  // otherwise. Called by every raw Collection read (find/_fetchQuery/_fetchCount/_fetchIds/
  // _unsafeFetchRaw) -- the only paths that bypass WorkQueue's own FIFO ordering entirely and so
  // need an explicit gate. Callers should check _readsUnblocked first (see above) rather than
  // relying on the equivalent check repeated here -- this one only exists to cover the (rare)
  // case where the fast path was missed between that check and this call.
  _whenReady(fn: () => void): void {
    if (this._readsUnblocked) {
      fn()
      return
    }
    if (process.env.NODE_ENV !== 'production' && !this._readyWarned) {
      this._readyWarned = true
      logger.warn(
        'Database was accessed before its `seed` (see `new Database({ seed })`) finished ' +
          'determining whether to run. This call has been queued and will run automatically ' +
          'once that resolves -- but if this is unexpected, check for code (a module-level ' +
          "singleton, a reader/writer that fires as soon as the app starts, etc.) that's " +
          'touching the database earlier than intended.',
      )
    }
    this._readyPromise.then(fn)
  }

  /**
   * Returns a `Collection` for a given table name, or Model class.
   *
   * `TableName<T>` is just `string` underneath (there's no way to encode a
   * real table's shape into a string literal type), so passing one directly
   * -- `database.get('comments')` -- infers nothing: you get back
   * `Collection<Model>`, and a typo'd/wrong table name is only caught at
   * runtime (as `null`), not by the type checker. Passing the Model class
   * instead -- `database.get(Comment)` -- infers `Collection<Comment>` for
   * real, and the class itself is a genuine, checked value (unlike an
   * arbitrary string), so prefer this form where you can.
   */
  get<T extends Model>(tableName: TableName<T>): Collection<T>
  get<T extends Model>(modelClass: ModelClassRef<T>): Collection<T>
  get<T extends Model>(tableNameOrModelClass: TableName<T> | ModelClassRef<T>): Collection<T> {
    const tableName =
      typeof tableNameOrModelClass === 'string'
        ? tableNameOrModelClass
        : tableNameOrModelClass.table
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
   *
   * If this `Database` was constructed with `seed` (see `DatabaseProps#seed`), it's reapplied
   * once the reset itself is done -- "all records, metadata, and LocalStorage" above includes the
   * durable marker tracking which steps already ran, so a reset genuinely does put the database
   * back in the same state a fresh install would be in, and this resolves once that's true again,
   * not just once the reset itself is.
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

      // Reapply seed, if configured -- the reset above wiped its applied-step marker along with
      // everything else, so from _runSeed's perspective this database is now indistinguishable
      // from a fresh install: every step is pending again. Called directly (not re-enqueued via
      // WorkQueue) since this method's own writer turn is already running, same as how a step's
      // own database.batch() calls work without needing callWriter(). Deliberately NOT touching
      // _ready/readyPromise/isReady for this -- unlike the initial construction-time seed, this
      // is a synchronous-feeling part of an already-awaited operation (unsafeResetDatabase()),
      // not something that needs its own separate readiness signal.
      if (this._seed) {
        await this._runSeed(this._seed)
      }
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
