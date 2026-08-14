import type { AnyMap, HybridObject } from 'react-native-nitro-modules'

export type SqliteValue = string | number | boolean | null
export type NitromelonCachedRecord = string | AnyMap
export type NitromelonFindResult = string | AnyMap | null
export type NitromelonQueryAsArrayItem = string | SqliteValue[]
export type NitromelonLocalValue = string | null
export type NitromelonBatchOperation = [number, string | null, string, SqliteValue[][]]

export interface NitromelonInitializeResult {
  code: string
  databaseVersion?: number
}

export interface NitromelonDatabase extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  initialize(dbName: string, expectedVersion: number): NitromelonInitializeResult
  setUpWithSchema(dbName: string, schema: string, schemaVersion: number): void
  setUpWithMigrations(dbName: string, migrationSchema: string, fromVersion: number, toVersion: number): void
  find(tableName: string, id: string): NitromelonFindResult
  query(tableName: string, sql: string, args: SqliteValue[]): NitromelonCachedRecord[]
  queryAsArray(tableName: string, sql: string, args: SqliteValue[]): NitromelonQueryAsArrayItem[]
  queryIds(sql: string, args: SqliteValue[]): string[]
  unsafeQueryRaw(sql: string, args: SqliteValue[]): AnyMap[]
  count(sql: string, args: SqliteValue[]): number
  batch(operations: NitromelonBatchOperation[]): void
  batchJSON(operations: string): void
  getLocal(key: string): NitromelonLocalValue
  unsafeLoadFromSync(jsonId: number, schema: AnyMap, preamble: string, postamble: string): AnyMap
  unsafeExecuteMultiple(sql: string): void
  unsafeResetDatabase(schema: string, schemaVersion: number): void
  unsafeClose(): void
}

export interface Nitromelon extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  createAdapter(dbName: string, usesExclusiveLocking: boolean): NitromelonDatabase
  provideSyncJson(id: number, json: string): void
}
