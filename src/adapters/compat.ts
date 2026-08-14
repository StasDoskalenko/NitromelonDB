import type { SerializedQuery } from '../Query'
import type { TableName, AppSchema } from '../Schema'
import type { SchemaMigrations } from '../Schema/migrations'
import type { RecordId } from '../Model'
import { toPromise } from '../utils/fp/Result'

import type {
  DatabaseAdapter,
  CachedFindResult,
  CachedQueryResult,
  BatchOperation,
  UnsafeExecuteOperations,
} from './type'

type CloneableAdapter = DatabaseAdapter & {
  testClone: (options: unknown) => Promise<DatabaseAdapter>
}

export default class DatabaseAdapterCompat {
  underlyingAdapter: DatabaseAdapter

  constructor(adapter: DatabaseAdapter) {
    this.underlyingAdapter = adapter
  }

  get schema(): AppSchema {
    return this.underlyingAdapter.schema
  }

  get dbName(): string | undefined {
    return this.underlyingAdapter.dbName
  }

  get migrations(): SchemaMigrations | null | undefined {
    return this.underlyingAdapter.migrations
  }

  find(table: TableName, id: RecordId): Promise<CachedFindResult> {
    return toPromise((callback) => this.underlyingAdapter.find(table, id, callback))
  }

  query(query: SerializedQuery): Promise<CachedQueryResult> {
    return toPromise((callback) => this.underlyingAdapter.query(query, callback))
  }

  queryIds(query: SerializedQuery): Promise<RecordId[]> {
    return toPromise((callback) => this.underlyingAdapter.queryIds(query, callback))
  }

  unsafeQueryRaw(query: SerializedQuery): Promise<unknown[]> {
    return toPromise((callback) => this.underlyingAdapter.unsafeQueryRaw(query, callback))
  }

  count(query: SerializedQuery): Promise<number> {
    return toPromise((callback) => this.underlyingAdapter.count(query, callback))
  }

  batch(operations: BatchOperation[]): Promise<void> {
    return toPromise((callback) => this.underlyingAdapter.batch(operations, callback))
  }

  getDeletedRecords(tableName: TableName): Promise<RecordId[]> {
    return toPromise((callback) => this.underlyingAdapter.getDeletedRecords(tableName, callback))
  }

  destroyDeletedRecords(tableName: TableName, recordIds: RecordId[]): Promise<void> {
    return toPromise((callback) =>
      this.underlyingAdapter.destroyDeletedRecords(tableName, recordIds, callback),
    )
  }

  unsafeLoadFromSync(jsonId: number): Promise<unknown> {
    return toPromise((callback) => this.underlyingAdapter.unsafeLoadFromSync(jsonId, callback))
  }

  provideSyncJson(id: number, syncPullResultJson: string): Promise<void> {
    return toPromise((callback) =>
      this.underlyingAdapter.provideSyncJson(id, syncPullResultJson, callback),
    )
  }

  unsafeResetDatabase(): Promise<void> {
    return toPromise((callback) => this.underlyingAdapter.unsafeResetDatabase(callback))
  }

  unsafeExecute(work: UnsafeExecuteOperations): Promise<void> {
    return toPromise((callback) => this.underlyingAdapter.unsafeExecute(work, callback))
  }

  getLocal(key: string): Promise<string | null | undefined> {
    return toPromise((callback) => this.underlyingAdapter.getLocal(key, callback))
  }

  setLocal(key: string, value: string): Promise<void> {
    return toPromise((callback) => this.underlyingAdapter.setLocal(key, value, callback))
  }

  removeLocal(key: string): Promise<void> {
    return toPromise((callback) => this.underlyingAdapter.removeLocal(key, callback))
  }

  // untyped - test-only code
  async testClone(options: unknown): Promise<DatabaseAdapterCompat> {
    const adapter = this.underlyingAdapter as CloneableAdapter
    return new DatabaseAdapterCompat(await adapter.testClone(options))
  }
}
