/* eslint-disable global-require */

import { connectionTag, type ConnectionTag, logger, invariant } from '../../utils/common'
import { type ResultCallback, mapValue, toPromise } from '../../utils/fp/Result'
import { mapObj } from '../../utils/fp'

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
  DispatcherType,
  SQL,
  SQLiteAdapterOptions,
  SQLiteArg,
  SQLiteQuery,
  SqliteDispatcher,
  MigrationEvents,
  InitializeStatus,
  NativeBridgeBatchOperation,
} from './type'

import encodeQuery from './encodeQuery'

import { makeDispatcher, getDispatcherType } from './makeDispatcher'

export type { SQL, SQLiteArg, SQLiteQuery }

type EncodeSchemaModule = {
  encodeSchema: (schema: AppSchema) => SQL
  encodeMigrationSteps: (steps: MigrationStep[]) => SQL
  encodeDropIndices: (schema: AppSchema) => SQL
  encodeCreateIndices: (schema: AppSchema) => SQL
}

type EncodeBatchFn = (
  operations: BatchOperation[],
  schema: AppSchema,
) => NativeBridgeBatchOperation[]

if (process.env.NODE_ENV !== 'production') {
  require('./devtools')
}

const IGNORE_CACHE = 0

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

  constructor(options: SQLiteAdapterOptions) {
    // console.log(`---> Initializing new adapter (${this._tag})`)
    const {
      dbName,
      schema,
      migrations,
      migrationEvents,
      usesExclusiveLocking = false,
      experimentalUnsafeNativeReuse = false,
    } = options
    this.schema = schema
    this.migrations = migrations ?? null
    this._migrationEvents = migrationEvents
    this.dbName = this._getName(dbName)
    this._dispatcherType = getDispatcherType(options)
    // Hacky-ish way to create an object with NativeModule-like shape, but that can dispatch method
    // calls to async, synch NativeModule, or JSI implementation w/ type safety in rest of the impl
    this._dispatcher = makeDispatcher(this._dispatcherType, this._tag, this.dbName, {
      usesExclusiveLocking,
      experimentalUnsafeNativeReuse,
    })

    if (process.env.NODE_ENV !== 'production') {
      validateAdapter(this)
    }

    this._initPromise = toPromise((callback) => {
      this._init((result) => {
        callback(result)
        devSetupCallback(result, options.onSetUpError)
      })
    })
  }

  get initializingPromise(): Promise<void> {
    return this._initPromise
  }

  async testClone(options: Partial<SQLiteAdapterOptions> = {}): Promise<SQLiteAdapter> {
    const clone = new SQLiteAdapter({
      dbName: this.dbName,
      schema: this.schema,
      jsi: this._dispatcherType !== 'asynchronous',
      ...(this.migrations ? { migrations: this.migrations } : {}),
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
    this._dispatcher.call<InitializeStatus>('initialize', [this.dbName, this.schema.version], (result) => {
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
    })
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
        mapValue(
          (rawRecord) => sanitizeFindResult(rawRecord, this.schema.tables[table]),
          result,
        ),
      ),
    )
  }

  query(query: SerializedQuery, callback: ResultCallback<CachedQueryResult>): void {
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
    validateTable(query.table, this.schema)
    this._dispatcher.call('queryIds', encodeQuery(query), callback)
  }

  unsafeQueryRaw(query: SerializedQuery, callback: ResultCallback<unknown[]>): void {
    validateTable(query.table, this.schema)
    this._dispatcher.call('unsafeQueryRaw', encodeQuery(query), callback)
  }

  count(query: SerializedQuery, callback: ResultCallback<number>): void {
    validateTable(query.table, this.schema)
    this._dispatcher.call('count', encodeQuery(query, true), callback)
  }

  batch(operations: BatchOperation[], callback: ResultCallback<void>): void {
    this._dispatcher.call(
      'batch',
      [
        (require('./encodeBatch') as { default: EncodeBatchFn }).default(
          operations,
          this.schema,
        ),
      ],
      callback,
    )
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

    const { encodeDropIndices, encodeCreateIndices } = require('./encodeSchema') as EncodeSchemaModule
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
      const batchOperations: NativeBridgeBatchOperation[] = queries.map(([sql, args]) => [
        IGNORE_CACHE,
        null,
        sql,
        [args],
      ])
      this._dispatcher.call('batch', [batchOperations], callback)
    } else if ('sqlString' in operations && operations.sqlString) {
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
