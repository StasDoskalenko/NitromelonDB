// don't import the whole utils/ here!
import invariant from '../../utils/common/invariant'
import logger from '../../utils/common/logger'
import type { ResultCallback, Result } from '../../utils/fp/Result'

import type { RecordId } from '../../Model'
import type { TableName, AppSchema } from '../../Schema'
import type { SchemaMigrations } from '../../Schema/migrations'
import type { SerializedQuery } from '../../Query'
import type {
  DatabaseAdapter,
  CachedQueryResult,
  CachedFindResult,
  BatchOperation,
  UnsafeExecuteOperations,
} from '../type'
import { devSetupCallback, validateAdapter, validateTable } from '../common'

import LokiDispatcher from './dispatcher'
import type { LokiAdapterOptions } from './type'
import type DatabaseDriver from './worker/DatabaseDriver'

export type { LokiAdapterOptions } from './type'

export default class LokiJSAdapter implements DatabaseAdapter {
  static adapterType: string = 'loki'

  _dispatcher: LokiDispatcher

  schema: AppSchema

  dbName: string

  migrations?: SchemaMigrations | null

  _options: LokiAdapterOptions

  constructor(options: LokiAdapterOptions) {
    this._options = options
    this.dbName = options.dbName || 'loki'
    const { schema, migrations } = options

    const useWebWorker = options.useWebWorker ?? process.env.NODE_ENV !== 'test'
    this._dispatcher = new LokiDispatcher(useWebWorker)

    this.schema = schema
    this.migrations = migrations ?? null

    if (process.env.NODE_ENV !== 'production') {
      invariant(
        'useWebWorker' in options,
        'LokiJSAdapter `useWebWorker` option is required. Pass `{ useWebWorker: false }` to adopt the new behavior, or `{ useWebWorker: true }` to supress this warning with no changes',
      )
      if (options.useWebWorker === true) {
        logger.warn(
          'LokiJSAdapter {useWebWorker: true} option is now deprecated. If you rely on this feature, please file an issue',
        )
      }
      invariant(
        'useIncrementalIndexedDB' in options,
        'LokiJSAdapter `useIncrementalIndexedDB` option is required. Pass `{ useIncrementalIndexedDB: true }` to adopt the new behavior, or `{ useIncrementalIndexedDB: false }` to supress this warning with no changes',
      )
      if (options.useIncrementalIndexedDB === false) {
        logger.warn(
          'LokiJSAdapter {useIncrementalIndexedDB: false} option is now deprecated. If you rely on this feature, please file an issue',
        )
      }
      validateAdapter(this)
    }
    const callback = (result: Result<unknown>) => devSetupCallback(result, options.onSetUpError)
    this._dispatcher.call('setUp', [options], callback)
  }

  async testClone(options: Partial<LokiAdapterOptions> = {}): Promise<LokiJSAdapter> {
    // Ensure data is saved to memory
    const driver = this._driver
    driver.loki.close()

    return new LokiJSAdapter({
      ...this._options,
      _testLokiAdapter: driver.loki.persistenceAdapter,
      ...options,
    })
  }

  find(table: TableName, id: RecordId, callback: ResultCallback<CachedFindResult>): void {
    validateTable(table, this.schema)
    this._dispatcher.call('find', [table, id], callback)
  }

  query(query: SerializedQuery, callback: ResultCallback<CachedQueryResult>): void {
    validateTable(query.table, this.schema)
    this._dispatcher.call('query', [query], callback)
  }

  queryIds(query: SerializedQuery, callback: ResultCallback<RecordId[]>): void {
    validateTable(query.table, this.schema)
    this._dispatcher.call('queryIds', [query], callback)
  }

  unsafeQueryRaw(query: SerializedQuery, callback: ResultCallback<unknown[]>): void {
    validateTable(query.table, this.schema)
    this._dispatcher.call('unsafeQueryRaw', [query], callback)
  }

  count(query: SerializedQuery, callback: ResultCallback<number>): void {
    validateTable(query.table, this.schema)
    this._dispatcher.call('count', [query], callback)
  }

  batch(operations: BatchOperation[], callback: ResultCallback<void>): void {
    operations.forEach(([, table]) => validateTable(table, this.schema))
    // batches are only strings + raws which only have JSON-compatible values, rest is immutable
    this._dispatcher.call('batch', [operations], callback, 'shallowCloneDeepObjects')
  }

  getDeletedRecords(table: TableName, callback: ResultCallback<RecordId[]>): void {
    validateTable(table, this.schema)
    this._dispatcher.call('getDeletedRecords', [table], callback)
  }

  destroyDeletedRecords(
    table: TableName,
    recordIds: RecordId[],
    callback: ResultCallback<void>,
  ): void {
    validateTable(table, this.schema)
    this._dispatcher.call(
      'batch',
      [recordIds.map((id) => ['destroyPermanently', table, id])],
      callback,
      'immutable',
      'immutable',
    )
  }

  unsafeLoadFromSync(_jsonId: number, callback: ResultCallback<unknown>): void {
    callback({ error: new Error('unsafeLoadFromSync unavailable in LokiJS') })
  }

  provideSyncJson(_id: number, _syncPullResultJson: string, callback: ResultCallback<void>): void {
    callback({ error: new Error('provideSyncJson unavailable in LokiJS') })
  }

  unsafeResetDatabase(callback: ResultCallback<void>): void {
    this._dispatcher.call('unsafeResetDatabase', [], callback)
  }

  unsafeExecute(operations: UnsafeExecuteOperations, callback: ResultCallback<void>): void {
    this._dispatcher.call('unsafeExecute', [operations], callback)
  }

  getLocal(key: string, callback: ResultCallback<string | null | undefined>): void {
    this._dispatcher.call('getLocal', [key], callback)
  }

  setLocal(key: string, value: string, callback: ResultCallback<void>): void {
    invariant(typeof value === 'string', 'adapter.setLocal() value must be a string')
    this._dispatcher.call('setLocal', [key, value], callback)
  }

  removeLocal(key: string, callback: ResultCallback<void>): void {
    this._dispatcher.call('removeLocal', [key], callback)
  }

  // dev/debug utility
  get _driver(): DatabaseDriver {
    const worker = this._dispatcher._worker as unknown as {
      _bridge: { driver: DatabaseDriver }
    }
    return worker._bridge.driver
  }

  // (experimental)
  _fatalError(error: Error): void {
    this._dispatcher.call('_fatalError', [error], () => {})
  }

  // (experimental)
  _clearCachedRecords(): void {
    this._dispatcher.call('clearCachedRecords', [], () => {})
  }

  _debugDignoseMissingRecord(table: TableName, id: RecordId): void {
    const driver = this._driver
    if (driver) {
      const lokiCollection = driver.loki.getCollection(table)
      // if we can find the record by ID, it just means that the record cache ID was corrupted
      const didFindById = !!lokiCollection.by('id', id)
      logger.log(`Did find ${table}#${id} in Loki collection by ID? ${didFindById}`)

      // if we can't, but can filter to it, it means that Loki indices are corrupted
      const didFindByFilter = !!lokiCollection.data.filter((doc) => doc.id === id)
      logger.log(
        `Did find ${table}#${id} in Loki collection by filtering the collection? ${didFindByFilter}`,
      )
    }
  }
}
