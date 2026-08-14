import type { ResultCallback } from '../../utils/fp/Result'

import type { RecordId } from '../../Model'
import type { SerializedQuery } from '../../Query'
import type { TableName, AppSchema } from '../../Schema'
import type { SchemaMigrations } from '../../Schema/migrations'
import type {
  DatabaseAdapter,
  CachedQueryResult,
  CachedFindResult,
  BatchOperation,
  UnsafeExecuteOperations,
} from '../type'

import type { RemoteHandler, RemoteAdapterOptions } from './type'

export default class RemoteAdapter implements DatabaseAdapter {
  schema: AppSchema
  declare dbName: string
  migrations?: SchemaMigrations | null
  handler: RemoteHandler

  constructor(options: RemoteAdapterOptions) {
    const { schema, migrations, handler } = options

    this.schema = schema
    this.migrations = migrations ?? null
    this.handler = handler
  }

  find(table: TableName, id: RecordId, callback: ResultCallback<CachedFindResult>): void {
    this.handler('find', [table, id], callback)
  }

  query(query: SerializedQuery, callback: ResultCallback<CachedQueryResult>): void {
    this.handler('query', [query], callback)
  }

  queryIds(query: SerializedQuery, callback: ResultCallback<RecordId[]>): void {
    this.handler('queryIds', [query], callback)
  }

  unsafeQueryRaw(query: SerializedQuery, callback: ResultCallback<unknown[]>): void {
    this.handler('unsafeQueryRaw', [query], callback)
  }

  count(query: SerializedQuery, callback: ResultCallback<number>): void {
    this.handler('count', [query], callback)
  }

  batch(operations: BatchOperation[], callback: ResultCallback<void>): void {
    this.handler('batch', [operations], callback)
  }

  getDeletedRecords(tableName: TableName, callback: ResultCallback<RecordId[]>): void {
    this.handler('getDeletedRecords', [tableName], callback)
  }

  destroyDeletedRecords(
    tableName: TableName,
    recordIds: RecordId[],
    callback: ResultCallback<void>,
  ): void {
    this.handler('destroyDeletedRecords', [tableName, recordIds], callback)
  }

  unsafeLoadFromSync(jsonId: number, callback: ResultCallback<unknown>): void {
    this.handler('unsafeLoadFromSync', [jsonId], callback)
  }

  provideSyncJson(id: number, syncPullResultJson: string, callback: ResultCallback<void>): void {
    this.handler('provideSyncJson', [id, syncPullResultJson], callback)
  }

  unsafeResetDatabase(callback: ResultCallback<void>): void {
    this.handler('unsafeResetDatabase', [], callback)
  }

  unsafeExecute(work: UnsafeExecuteOperations, callback: ResultCallback<void>): void {
    this.handler('unsafeExecute', [work], callback)
  }

  getLocal(key: string, callback: ResultCallback<string | null | undefined>): void {
    this.handler('getLocal', [key], callback)
  }

  setLocal(key: string, value: string, callback: ResultCallback<void>): void {
    this.handler('setLocal', [key, value], callback)
  }

  removeLocal(key: string, callback: ResultCallback<void>): void {
    this.handler('removeLocal', [key], callback)
  }
}
