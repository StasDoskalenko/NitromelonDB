/* eslint-disable global-require */

import { connectionTag, type ConnectionTag, logger, invariant } from '../../utils/common'
import { type ResultCallback, mapValue, toPromise } from '../../utils/fp/Result'
import { mapObj, unnest } from '../../utils/fp'

import type { RecordId } from '../../Model'
import type { SerializedQuery } from '../../Query'
import type { TableName, AppSchema, SchemaVersion } from '../../Schema'
import type { SchemaMigrations, MigrationStep } from '../../Schema/migrations'
import type {
  DatabaseAdapter,
  CachedQueryResult,
  CachedFindResult,
  BatchOperation,
  UnsafeExecuteOperations,
} from '../type'
import {
  sanitizeFindResult,
  sanitizeQueryResult,
  devSetupCallback,
  validateAdapter,
  validateTable,
  type DirtyFindResult,
  type DirtyQueryResult,
} from '../common'
import type {
  DatabaseEncryptionState,
  DispatcherType,
  EncryptionEvents,
  EncryptionOptions,
  EncryptionOperation,
  EncryptionPassphrase,
  SQL,
  SQLiteAdapterOptions,
  SQLiteArg,
  SQLiteQuery,
  SqliteDispatcher,
  SqliteDispatcherMethod,
  MigrationEvents,
  InitializeStatus,
  NativeBridgeBatchOperation,
} from './type'

import encodeQuery from './encodeQuery'
import encodeLocalChangesQueries from './encodeLocalChangesQuery'
import convertWholeNumbers, { type NumberStorageConversionResult } from './convertWholeNumbers'

import {
  makeDispatcher,
  getDispatcherType,
  isEncryptionAvailable,
  getDatabaseEncryptionState,
  encryptionUnavailableHint,
} from './makeDispatcher'
import HoldingDispatcher from './HoldingDispatcher'

export type { SQL, SQLiteArg, SQLiteQuery }
export type {
  DatabaseEncryptionState,
  EncryptionErrorCode,
  EncryptionEvents,
  EncryptionOperation,
  EncryptionOptions,
  EncryptionPassphrase,
} from './type'

const ENCRYPTION_GUIDE = 'https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/Intro'
const ENCRYPTION_SETUP_GUIDE = 'https://stasdoskalenko.github.io/NitromelonDB/docs/Encryption/Setup'

function encryptionError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

// A passphrase must be a non-empty string: "no key" is never a way to open (or decrypt) a database
function checkPassphrase(passphrase: unknown): string {
  if (typeof passphrase !== 'string' || !passphrase) {
    throw encryptionError(
      'encryption_key_required',
      `SQLiteAdapter: encryption.passphrase gave ${
        passphrase === '' ? 'an empty string' : String(passphrase)
      } instead of a passphrase. NitromelonDB never opens an encrypted database without one (to decrypt it, call database.unsafe_DecryptDB()).`,
    )
  }
  return passphrase
}

async function resolvePassphrase(passphrase: EncryptionPassphrase): Promise<string> {
  return checkPassphrase(typeof passphrase === 'function' ? await passphrase() : passphrase)
}

type EncodeSchemaModule = {
  encodeSchema: (schema: AppSchema) => SQL
  encodeMigrationSteps: (steps: MigrationStep[]) => SQL
  encodeDropIndices: (schema: AppSchema) => SQL
  encodeCreateIndices: (schema: AppSchema) => SQL
}

type EncodeBatchFn = (
  operations: BatchOperation[],
  schema: AppSchema,
  tablesToReindex?: TableName[],
) => NativeBridgeBatchOperation[]

if (process.env.NODE_ENV !== 'production') {
  require('./devtools')
}

const IGNORE_CACHE = 0

// What can still run once setting up the database failed: setting it up again (that's how
// unsafeResetDatabase() recovers), and closing the connection
const CALLABLE_AFTER_FAILED_SET_UP: ReadonlySet<SqliteDispatcherMethod> = new Set([
  'setUpWithSchema',
  'unsafeCloseConnection',
])

export default class SQLiteAdapter implements DatabaseAdapter {
  static adapterType: string = 'sqlite'

  schema: AppSchema

  migrations: SchemaMigrations | null

  _migrationEvents?: MigrationEvents | undefined

  _tag: ConnectionTag = connectionTag()

  dbName: string

  _dispatcherType: DispatcherType

  _dispatcher: SqliteDispatcher

  _initPromise: Promise<void>

  // Set when setting up the database failed (e.g. it has tables but no schema version). There's no
  // working connection then: other calls fail with this error instead of reaching the database
  // (native asserts it's set up), and unsafeResetDatabase() sets the database up instead
  _setUpError: Error | null = null

  // Converting the numbers already stored after storeWholeNumbersAsIntegers was turned on or off (see
  // convertWholeNumbers). Internal (tests await it): nothing an app does needs to wait, since only raw
  // SQL can tell the two formats apart, and initializingPromise doesn't wait, so launch isn't delayed
  _numberStorageConversion: Promise<NumberStorageConversionResult>

  // Development builds with storeWholeNumbersAsIntegers: warns about raw SQL that can see it
  _checkStorageSensitiveQuery: ((query: SerializedQuery) => void) | null = null

  _checkStorageSensitiveSql: ((sql: string) => void) | null = null

  // With the `encryption` option only: holds calls while the passphrase resolves or the key changes
  _holdingDispatcher: HoldingDispatcher | null = null

  _encryptionEvents: EncryptionOptions['events']

  // Added with subscribeToEncryptionEvents(), called after `encryption.events`
  _encryptionListeners: Set<{ events: EncryptionEvents }> = new Set()

  _encryptionOptions: EncryptionOptions | undefined

  // Whether this build of the app has the codec ("nitromelondb": { "encryption": true } in the app's
  // package.json; on Node, better-sqlite3-multiple-ciphers installed). False on web, and in the
  // default native build. See docs/Encryption/Intro
  static isEncryptionAvailable(): boolean {
    return isEncryptionAvailable()
  }

  // What the database file looks like, before an adapter opens it: 'missing' (a new install),
  // 'unencrypted' (a plain SQLite file), or 'encrypted' (anything else: a damaged file looks the same,
  // so only opening it with the passphrase proves it). Reads the first bytes of the file only.
  // iOS, Android and Windows.
  static async getDatabaseEncryptionState(dbName?: string): Promise<DatabaseEncryptionState> {
    return getDatabaseEncryptionState(dbName || 'watermelon')
  }

  constructor(options: SQLiteAdapterOptions) {
    // console.log(`---> Initializing new adapter (${this._tag})`)
    const {
      dbName,
      schema,
      migrations,
      migrationEvents,
      usesExclusiveLocking = false,
      storeWholeNumbersAsIntegers = false,
      experimentalUnsafeNativeReuse = false,
    } = options
    this.schema = schema
    this.migrations = migrations ?? null
    this._migrationEvents = migrationEvents
    this.dbName = this._getName(dbName)
    this._dispatcherType = getDispatcherType(options)
    const dispatcherOptions = {
      usesExclusiveLocking,
      storeWholeNumbersAsIntegers,
      experimentalUnsafeNativeReuse,
      ...(options.web ? { web: options.web } : {}),
    }
    // Hacky-ish way to create an object with NativeModule-like shape, but that can dispatch method
    // calls to async, synch NativeModule, or JSI implementation w/ type safety in rest of the impl
    let dispatcher: SqliteDispatcher
    const { encryption } = options
    if (encryption) {
      this._checkEncryptionSupport(encryption)
      this._encryptionOptions = encryption
      this._encryptionEvents = encryption.events
      const holding = new HoldingDispatcher()
      this._holdingDispatcher = holding
      dispatcher = holding
      const open = (passphrase: string) =>
        makeDispatcher(this._dispatcherType, this._tag, this.dbName, {
          ...dispatcherOptions,
          passphrase,
          allowUnencrypted: encryption.ifUnencrypted === 'open',
        })
      if (typeof encryption.passphrase === 'function') {
        // Calls wait in `holding` until the passphrase is there; if it can't be had, they fail
        resolvePassphrase(encryption.passphrase)
          .then((passphrase) => holding.setTarget(open(passphrase)))
          .catch((error: Error) => holding.fail(error))
      } else {
        holding.setTarget(open(checkPassphrase(encryption.passphrase)))
      }
    } else {
      dispatcher = makeDispatcher(this._dispatcherType, this._tag, this.dbName, dispatcherOptions)
    }
    this._dispatcher = {
      call: (methodName, args, callback) => {
        const setUpError = this._setUpError
        if (setUpError && !CALLABLE_AFTER_FAILED_SET_UP.has(methodName)) {
          callback({
            error: new Error(
              `The database couldn't be set up, so ${methodName}() can't run. ${setUpError.message}`,
            ),
          })
          return
        }
        dispatcher.call(methodName, args, callback)
      },
    }

    if (process.env.NODE_ENV !== 'production') {
      validateAdapter(this)
    }

    this._initPromise = toPromise((callback) => {
      this._init((result) => {
        if (result.error) {
          this._setUpError = result.error
        }
        callback(result)
        devSetupCallback(result, options.onSetUpError)
      })
    })

    // Converts the numbers already stored when storeWholeNumbersAsIntegers was turned on, or off
    // again (see convertWholeNumbers). Without the option, that's one local storage read, in the
    // background, to check it was never on. Web ignores the option.
    this._numberStorageConversion =
      this._dispatcherType === 'wa-sqlite'
        ? Promise.resolve('unchanged')
        : this._initPromise.then(
            () => this._convertWholeNumbers(storeWholeNumbersAsIntegers),
            () => 'interrupted' as const,
          )

    if (
      storeWholeNumbersAsIntegers &&
      this._dispatcherType !== 'wa-sqlite' &&
      process.env.NODE_ENV !== 'production'
    ) {
      const warnings = require('./warnStorageSensitiveSql') as {
        warnStorageSensitiveQuery: (query: SerializedQuery, schema: AppSchema) => void
        warnStorageSensitiveSql: (sql: string) => void
      }
      this._checkStorageSensitiveQuery = (query) =>
        warnings.warnStorageSensitiveQuery(query, this.schema)
      this._checkStorageSensitiveSql = warnings.warnStorageSensitiveSql
    }
  }

  get initializingPromise(): Promise<void> {
    return this._initPromise
  }

  async _convertWholeNumbers(
    storeWholeNumbersAsIntegers: boolean,
  ): Promise<NumberStorageConversionResult> {
    const start = Date.now()
    try {
      const result = await convertWholeNumbers(
        this._dispatcher,
        this.schema,
        storeWholeNumbersAsIntegers,
      )
      if (result === 'converted' && process.env.NODE_ENV !== 'production') {
        logger.log(
          `[🍉] storeWholeNumbersAsIntegers: converted the numbers already stored to ${
            storeWholeNumbersAsIntegers ? 'INTEGER' : 'REAL'
          } in ${Date.now() - start} ms`,
        )
      }
      return result
    } catch (error) {
      logger.log(
        `[🍉] storeWholeNumbersAsIntegers: converting the numbers already stored stopped, it continues on the next launch. ${
          (error as Error).message
        }`,
      )
      return 'interrupted'
    }
  }

  // Which SQLite dispatcher is actually backing this adapter (`_dispatcherType` is an
  // internal implementation detail; this is the public, stable way to read it — e.g. for a
  // diagnostics/about screen).
  get dispatcherType(): DispatcherType {
    return this._dispatcherType
  }

  _checkEncryptionSupport(encryption: EncryptionOptions): void {
    invariant(
      encryption && typeof encryption === 'object' && 'passphrase' in encryption,
      'SQLiteAdapter: `encryption` must be an object with a `passphrase`',
    )
    invariant(
      encryption.ifUnencrypted === undefined ||
        encryption.ifUnencrypted === 'error' ||
        encryption.ifUnencrypted === 'open',
      "SQLiteAdapter: encryption.ifUnencrypted must be 'error' or 'open'",
    )
    if (this._dispatcherType === 'wa-sqlite') {
      throw encryptionError(
        'encryption_unavailable',
        `SQLiteAdapter: encryption is supported on iOS, Android, Windows and Node/Electron, not with the wa-sqlite SQLite adapter (web). See ${ENCRYPTION_GUIDE}`,
      )
    }
    // Node/Electron: with better-sqlite3-multiple-ciphers installed
    if (this._dispatcherType === 'asynchronous' && !isEncryptionAvailable()) {
      throw encryptionError(
        'encryption_unavailable',
        `SQLiteAdapter: \`encryption\` was passed, but better-sqlite3 has no encryption, so the database would not be encrypted. ${encryptionUnavailableHint()}`,
      )
    }
    // The upstream WatermelonDB PR's bug was a build flag that silently didn't apply, leaving a
    // plaintext database. Fail loudly instead, before anything is written
    if (!isEncryptionAvailable()) {
      throw encryptionError(
        'encryption_unavailable',
        `SQLiteAdapter: \`encryption\` was passed, but this build of the app has no encryption, so the database would not be encrypted. Turn on the encryption build with "nitromelondb": { "encryption": true } in the app's package.json (or NITROMELONDB_ENCRYPTION=1), then rebuild the native app (on iOS, run pod install again). If it's already on, look for "SQLite encryption build" in the build log: the switch may be in a package.json that isn't the app's, or NITROMELONDB_ENCRYPTION=0 may be set. See ${ENCRYPTION_SETUP_GUIDE}`,
      )
    }
  }

  // Whether the adapter was created with the `encryption` option, which database.unsafe_EncryptDB()
  // and unsafe_DecryptDB() need (so that the database can be opened again on the next launch)
  get encryptionEnabled(): boolean {
    return this._holdingDispatcher !== null
  }

  // Calls `events` for every database.unsafe_EncryptDB() and unsafe_DecryptDB() from now on, like
  // `encryption.events` does (useEncryption uses it). Returns a function that unsubscribes.
  subscribeToEncryptionEvents(events: EncryptionEvents): () => void {
    const entry = { events }
    this._encryptionListeners.add(entry)
    return () => {
      this._encryptionListeners.delete(entry)
    }
  }

  // A listener that throws is logged, and doesn't stop the others or the re-key
  _emitEncryptionEvent(
    name: keyof EncryptionEvents,
    call: (events: EncryptionEvents) => void,
  ): void {
    const listeners = [
      this._encryptionEvents,
      ...[...this._encryptionListeners].map((entry) => entry.events),
    ]
    listeners.forEach((events) => {
      if (!events) {
        return
      }
      try {
        call(events)
      } catch (error) {
        logger.error(`[SQLite] encryption.events.${String(name)} threw`, error)
      }
    })
  }

  // Native only: the re-key runs on a background thread, and native code tells how far it has come
  // (encryption::RekeyProgress). On Node, SQLite runs on the JS thread, so nothing could ask meanwhile
  _pollEncryptionProgress(holding: HoldingDispatcher, operation: EncryptionOperation): () => void {
    if (this._dispatcherType !== 'nitro' && this._dispatcherType !== 'jsi') {
      return () => {}
    }
    let last = 0
    const timer = setInterval(() => {
      holding.callNow<number>('encryptionProgress', [], (result) => {
        const progress = result.value
        // -1: not started yet, or already done
        if (typeof progress !== 'number' || progress < 0 || progress - last < 0.01) {
          return
        }
        last = progress
        this._emitEncryptionEvent('onProgress', (events) =>
          events.onProgress?.({ operation, progress }),
        )
      })
    }, 200)
    return () => clearInterval(timer)
  }

  // Whether the open connection is encrypted. False without the `encryption` option (and on web).
  // Waits for setup.
  isEncrypted(callback: ResultCallback<boolean>): void {
    if (!this._holdingDispatcher) {
      callback({ value: false })
      return
    }
    this._dispatcher.call('isEncrypted', [], callback)
  }

  // Encrypts the database with `newPassphrase`, changes its key, or with '' decrypts it, in place.
  // Use database.unsafe_EncryptDB() / unsafe_DecryptDB(), which make sure no write is running.
  // Every other call made meanwhile waits until it's done.
  unsafeChangeEncryptionKey(newPassphrase: string, callback: ResultCallback<void>): void {
    const holding = this._holdingDispatcher
    if (!holding) {
      callback({
        error: encryptionError(
          'encryption_unavailable',
          `Changing the encryption key needs SQLiteAdapter's \`encryption\` option (with ifUnencrypted: 'open' for a database that isn't encrypted yet), so the database can be opened again on the next launch. See ${ENCRYPTION_GUIDE}`,
        ),
      })
      return
    }
    if (typeof newPassphrase !== 'string') {
      callback({ error: new Error('unsafeChangeEncryptionKey(newPassphrase) expects a string') })
      return
    }

    // Goes out after anything already called, and before anything called after this
    this._dispatcher.call<boolean>('isEncrypted', [], (encryptedResult) => {
      if (encryptedResult.error) {
        callback(encryptedResult)
        return
      }
      const wasEncrypted = encryptedResult.value
      const operation: EncryptionOperation = !newPassphrase
        ? 'decrypt'
        : wasEncrypted
          ? 'rekey'
          : 'encrypt'
      if (operation === 'decrypt' && !wasEncrypted) {
        callback({ value: undefined })
        return
      }

      const release = holding.hold()
      let stopProgress = () => {}
      const finish = (result: { error?: Error | undefined }, durationMs: number) => {
        stopProgress()
        release()
        const { error } = result
        if (error) {
          logger.error(`[SQLite] Failed to ${operation} the database`, error)
          this._emitEncryptionEvent('onError', (events) => events.onError?.(error))
          callback({ error })
        } else {
          logger.log(`[SQLite] ${operation} done in ${durationMs} ms`)
          this._emitEncryptionEvent('onSuccess', (events) =>
            events.onSuccess?.({ operation, durationMs }),
          )
          callback({ value: undefined })
        }
      }

      holding.callNow<Array<{ pageCount: number; byteSize: number }>>(
        'unsafeQueryRaw',
        [
          'select page_count as pageCount, page_count * page_size as byteSize from pragma_page_count(), pragma_page_size()',
          [],
        ],
        (sizeResult) => {
          const size = sizeResult.value?.[0] ?? { pageCount: 0, byteSize: 0 }
          this._emitEncryptionEvent('onStart', (events) =>
            events.onStart?.({ operation, pageCount: size.pageCount, byteSize: size.byteSize }),
          )
          const start = Date.now()
          stopProgress = this._pollEncryptionProgress(holding, operation)
          holding.callNow<void>('changeEncryptionKey', [newPassphrase], (result) =>
            finish(result, Date.now() - start),
          )
        },
      )
    })
  }

  async testClone(options: Partial<SQLiteAdapterOptions> = {}): Promise<SQLiteAdapter> {
    const clone = new SQLiteAdapter({
      dbName: this.dbName,
      schema: this.schema,
      jsi: this._dispatcherType !== 'asynchronous',
      ...(this.migrations ? { migrations: this.migrations } : {}),
      ...(this._encryptionOptions ? { encryption: this._encryptionOptions } : {}),
      ...options,
    } as SQLiteAdapterOptions)
    invariant(
      clone._dispatcherType === this._dispatcherType,
      'testCloned adapter has bad dispatcher type',
    )
    await clone._initPromise
    return clone
  }

  _getName(name?: string | null): string {
    if (process.env.NODE_ENV === 'test') {
      return name || `file:testdb${this._tag}?mode=memory&cache=shared`
    }

    return name || 'watermelon'
  }

  _init(callback: ResultCallback<void>): void {
    // Try to initialize the database with just the schema number. If it matches the database,
    // we're good. If not, we try again, this time sending the compiled schema or a migration set
    // This is to speed up the launch (less to do and pass through bridge), and avoid repeating
    // migration logic inside native code
    this._dispatcher.call<InitializeStatus>(
      'initialize',
      [this.dbName, this.schema.version],
      (result) => {
        if (result.error) {
          callback(result)
          return
        }

        const status = result.value
        if (status.code === 'schema_needed') {
          this._setUpWithSchema(callback)
        } else if (status.code === 'migrations_needed') {
          this._setUpWithMigrations(status.databaseVersion, callback)
        } else if (status.code !== 'ok') {
          callback({ error: new Error('Invalid database initialization status') })
        } else {
          callback({ value: undefined })
        }
      },
    )
  }

  _setUpWithMigrations(databaseVersion: SchemaVersion, callback: ResultCallback<void>): void {
    logger.log('[SQLite] Database needs migrations')
    invariant(databaseVersion > 0, 'Invalid database schema version')

    const migrationSteps = this._migrationSteps(databaseVersion)

    if (migrationSteps) {
      logger.log(`[SQLite] Migrating from version ${databaseVersion} to ${this.schema.version}...`)

      if (this._migrationEvents && this._migrationEvents.onStart) {
        this._migrationEvents.onStart()
      }

      this._dispatcher.call<void>(
        'setUpWithMigrations',
        [
          this.dbName,
          (require('./encodeSchema') as EncodeSchemaModule).encodeMigrationSteps(migrationSteps),
          databaseVersion,
          this.schema.version,
        ],
        (result) => {
          if (result.error) {
            logger.error('[SQLite] Migration failed', result.error)
            if (this._migrationEvents && this._migrationEvents.onError) {
              this._migrationEvents.onError(result.error)
            }
          } else {
            logger.log('[SQLite] Migration successful')
            if (this._migrationEvents && this._migrationEvents.onSuccess) {
              this._migrationEvents.onSuccess()
            }
          }
          callback(result)
        },
      )
    } else {
      logger.warn(
        '[SQLite] Migrations not available for this version range, resetting database instead',
      )
      this._setUpWithSchema(callback)
    }
  }

  _setUpWithSchema(callback: ResultCallback<void>): void {
    logger.log(`[SQLite] Setting up database with schema version ${this.schema.version}`)
    this._dispatcher.call<void>(
      'setUpWithSchema',
      [this.dbName, this._encodedSchema(), this.schema.version],
      (result) => {
        if (!result.error) {
          logger.log(`[SQLite] Schema set up successfully`)
        }
        callback(result)
      },
    )
  }

  find(table: TableName, id: RecordId, callback: ResultCallback<CachedFindResult>): void {
    validateTable(table, this.schema)
    this._dispatcher.call<DirtyFindResult>('find', [table, id], (result) =>
      callback(
        mapValue((rawRecord) => sanitizeFindResult(rawRecord, this.schema.tables[table]), result),
      ),
    )
  }

  query(query: SerializedQuery, callback: ResultCallback<CachedQueryResult>): void {
    this._checkStorageSensitiveQuery?.(query)
    validateTable(query.table, this.schema)
    const { table } = query
    const [sql, args] = encodeQuery(query)
    this._dispatcher.call<DirtyQueryResult>('query', [table, sql, args], (result) =>
      callback(
        mapValue(
          (rawRecords) => sanitizeQueryResult(rawRecords, this.schema.tables[table]),
          result,
        ),
      ),
    )
  }

  queryIds(query: SerializedQuery, callback: ResultCallback<RecordId[]>): void {
    this._checkStorageSensitiveQuery?.(query)
    validateTable(query.table, this.schema)
    this._dispatcher.call('queryIds', encodeQuery(query), callback)
  }

  unsafeQueryRaw(query: SerializedQuery, callback: ResultCallback<unknown[]>): void {
    this._checkStorageSensitiveQuery?.(query)
    validateTable(query.table, this.schema)
    this._dispatcher.call('unsafeQueryRaw', encodeQuery(query), callback)
  }

  count(query: SerializedQuery, callback: ResultCallback<number>): void {
    this._checkStorageSensitiveQuery?.(query)
    validateTable(query.table, this.schema)
    this._dispatcher.call('count', encodeQuery(query, true), callback)
  }

  batch(operations: BatchOperation[], callback: ResultCallback<void>): void {
    const encodeBatch = require('./encodeBatch') as {
      default: EncodeBatchFn
      largeBatchTables: (operations: BatchOperation[]) => Map<TableName, number>
    }
    const send = (tablesToReindex: TableName[]) =>
      this._dispatcher.call(
        'batch',
        [encodeBatch.default(operations, this.schema, tablesToReindex)],
        callback,
      )

    const candidates = encodeBatch.largeBatchTables(operations)
    if (!candidates.size) {
      send([])
      return
    }
    this._tablesToReindex(candidates, send)
  }

  // Dropping a table's indices before a large batch and recreating them after is faster than
  // updating them row by row -- but only if the batch writes about as many rows as the table
  // already has. Recreating scans and sorts the whole table, so doing it for every chunk of a
  // chunked sync into a big table made each chunk cost O(table size) (3-7x slower at 100k rows).
  // Reindex only tables where the batch has at least as many operations as the table has rows.
  //
  // Deciding needs row counts, and the batch must still reach the database in call order: a read
  // issued right after batch() must not run before it. So `done` is always called before this
  // returns. Counts are used only if the dispatcher answers them synchronously (Nitro, and Node
  // once open). Otherwise the batch goes out now without reindexing. The web dispatcher is
  // always async, so it doesn't ask at all.
  _tablesToReindex(candidates: Map<TableName, number>, done: (tables: TableName[]) => void): void {
    if (this._dispatcherType === 'wa-sqlite') {
      done([])
      return
    }
    const tables: TableName[] = []
    let decided = false
    for (const [table, operationCount] of candidates) {
      let answered = false
      this._dispatcher.call<number>(
        'count',
        [`select count(*) as "count" from "${table}"`, []],
        (result) => {
          answered = true
          // A failed count (or one answered too late) only costs the optimization
          if (!decided && typeof result.value === 'number' && operationCount >= result.value) {
            tables.push(table)
          }
        },
      )
      if (!answered) {
        decided = true
        done([])
        return
      }
    }
    decided = true
    done(tables)
  }

  destroyMatching(
    query: SerializedQuery,
    permanently: boolean,
    callback: ResultCallback<RecordId[]>,
  ): void {
    validateTable(query.table, this.schema)
    this._checkStorageSensitiveQuery?.(query)
    const { table, description, associations } = query
    // "The whole table" -- no predicate at all -- gets a bare delete/update below instead of a
    // `where id in (...)` filter, so SQLite can take its truncate-optimization fast path (see
    // native/shared/Database-batch.cpp's Database::destroyMatching for the full reasoning).
    const isUnconditional =
      !description.sql &&
      !description.where.length &&
      !associations.length &&
      !description.take &&
      !description.skip
    this._dispatcher.call(
      'destroyMatching',
      [table, ...encodeQuery(query), permanently, isUnconditional],
      callback,
    )
  }

  // See encodeLocalChangesQueries(). Like every other method here, answers through the callback as
  // soon as the dispatcher does -- synchronously on Nitro.
  tablesWithLocalChanges(tables: TableName[], callback: ResultCallback<TableName[]>): void {
    tables.forEach((table) => validateTable(table, this.schema))
    const queries = encodeLocalChangesQueries(tables)

    // Up to 400 tables -- practically every app: one query, answered directly
    if (queries.length <= 1) {
      if (queries.length) {
        this._dispatcher.call('queryIds', [queries[0], []], callback)
      } else {
        callback({ value: [] })
      }
      return
    }

    // More: send every chunk back to back, so no later adapter call gets between them, and answer
    // once -- with all chunks' tables, or with the first error
    const answers: TableName[][] = []
    let unanswered = queries.length
    let failed = false
    queries.forEach((sql, index) => {
      this._dispatcher.call<TableName[]>('queryIds', [sql, []], (result) => {
        if (failed) {
          return
        }
        if (result.error) {
          failed = true
          callback(result)
          return
        }
        answers[index] = result.value
        unanswered -= 1
        if (!unanswered) {
          callback({ value: unnest(answers) })
        }
      })
    })
  }

  getDeletedRecords(table: TableName, callback: ResultCallback<RecordId[]>): void {
    validateTable(table, this.schema)
    this._dispatcher.call(
      'queryIds',
      [`select id from "${table}" where _status='deleted'`, []],
      callback,
    )
  }

  destroyDeletedRecords(
    table: TableName,
    recordIds: RecordId[],
    callback: ResultCallback<void>,
  ): void {
    validateTable(table, this.schema)
    const operation: NativeBridgeBatchOperation = [
      0,
      null,
      `delete from "${table}" where "id" == ?`,
      recordIds.map((id) => [id]),
    ]
    this._dispatcher.call('batch', [[operation]], callback)
  }

  unsafeLoadFromSync(jsonId: number, callback: ResultCallback<unknown>): void {
    if (this._dispatcherType === 'asynchronous') {
      callback({ error: new Error('unsafeLoadFromSync unavailable. Use JSI mode to enable.') })
      return
    }

    const { encodeDropIndices, encodeCreateIndices } =
      require('./encodeSchema') as EncodeSchemaModule
    const { schema } = this
    this._dispatcher.call<Record<string, string>>(
      'unsafeLoadFromSync',
      [jsonId, schema, encodeDropIndices(schema), encodeCreateIndices(schema)],
      (result) =>
        callback(
          mapValue((residualValues) => {
            return mapObj((values: string) => JSON.parse(values) as unknown, residualValues)
          }, result),
        ),
    )
  }

  provideSyncJson(id: number, syncPullResultJson: string, callback: ResultCallback<void>): void {
    if (this._dispatcherType === 'asynchronous') {
      callback({ error: new Error('provideSyncJson unavailable. Use JSI mode to enable.') })
      return
    }

    this._dispatcher.call('provideSyncJson', [id, syncPullResultJson], callback)
  }

  unsafeResetDatabase(callback: ResultCallback<void>): void {
    if (this._setUpError) {
      // Setting up from scratch is what a reset does anyway
      this._setUpWithSchema((result) => {
        if (!result.error) {
          this._setUpError = null
          logger.log('[SQLite] Database is now reset')
        }
        callback(result)
      })
      return
    }
    this._dispatcher.call<void>(
      'unsafeResetDatabase',
      [this._encodedSchema(), this.schema.version],
      (result) => {
        if (result.value) {
          logger.log('[SQLite] Database is now reset')
        }
        callback(result)
      },
    )
  }

  // Node/Electron only — releases the native file handle so the database file
  // can be deleted or reopened elsewhere. Native (iOS/Android/Windows Nitro)
  // has no equivalent: the app process owns the connection for its lifetime.
  unsafeCloseConnection(callback: ResultCallback<void>): void {
    this._dispatcher.call<void>('unsafeCloseConnection', [], callback)
  }

  unsafeExecute(operations: UnsafeExecuteOperations, callback: ResultCallback<void>): void {
    if (process.env.NODE_ENV !== 'production') {
      const ops = operations as { sqls?: unknown; sqlString?: unknown }
      invariant(
        operations &&
          typeof operations === 'object' &&
          Object.keys(operations).length === 1 &&
          (Array.isArray(ops.sqls) || typeof ops.sqlString === 'string'),
        "unsafeExecute expects an { sqls: [ [sql, [args..]], ... ] } or { sqlString: 'foo; bar' } object",
      )
    }
    if ('sqls' in operations && operations.sqls) {
      const queries: SQLiteQuery[] = operations.sqls
      queries.forEach(([sql]) => this._checkStorageSensitiveSql?.(sql))
      const batchOperations: NativeBridgeBatchOperation[] = queries.map(([sql, args]) => [
        IGNORE_CACHE,
        null,
        sql,
        [args],
      ])
      this._dispatcher.call('batch', [batchOperations], callback)
    } else if ('sqlString' in operations && operations.sqlString) {
      this._checkStorageSensitiveSql?.(operations.sqlString)
      this._dispatcher.call('unsafeExecuteMultiple', [operations.sqlString], callback)
    }
  }

  getLocal(key: string, callback: ResultCallback<string | null | undefined>): void {
    this._dispatcher.call('getLocal', [key], callback)
  }

  setLocal(key: string, value: string, callback: ResultCallback<void>): void {
    invariant(typeof value === 'string', 'adapter.setLocal() value must be a string')
    const operation: NativeBridgeBatchOperation = [
      IGNORE_CACHE,
      null,
      `insert or replace into "local_storage" ("key", "value") values (?, ?)`,
      [[key, value]],
    ]
    this._dispatcher.call('batch', [[operation]], callback)
  }

  removeLocal(key: string, callback: ResultCallback<void>): void {
    const operation: NativeBridgeBatchOperation = [
      IGNORE_CACHE,
      null,
      `delete from "local_storage" where "key" == ?`,
      [[key]],
    ]
    this._dispatcher.call('batch', [[operation]], callback)
  }

  _encodedSchema(): SQL {
    return (require('./encodeSchema') as EncodeSchemaModule).encodeSchema(this.schema)
  }

  _migrationSteps(fromVersion: SchemaVersion): MigrationStep[] | null | undefined {
    const { stepsForMigration } = require('../../Schema/migrations/stepsForMigration') as {
      stepsForMigration: (args: {
        migrations: SchemaMigrations
        fromVersion: SchemaVersion
        toVersion: SchemaVersion
      }) => MigrationStep[] | null
    }
    const { migrations } = this
    // TODO: Remove this after migrations are shipped
    if (!migrations) {
      return null
    }
    return stepsForMigration({
      migrations,
      fromVersion,
      toVersion: this.schema.version,
    })
  }
}
