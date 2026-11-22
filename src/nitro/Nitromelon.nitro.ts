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
  setUpWithMigrations(
    dbName: string,
    migrationSchema: string,
    fromVersion: number,
    toVersion: number,
  ): void
  find(tableName: string, id: string): NitromelonFindResult
  query(tableName: string, sql: string, args: SqliteValue[]): NitromelonCachedRecord[]
  queryAsArray(tableName: string, sql: string, args: SqliteValue[]): NitromelonQueryAsArrayItem[]
  queryIds(sql: string, args: SqliteValue[]): string[]
  unsafeQueryRaw(sql: string, args: SqliteValue[]): AnyMap[]
  count(sql: string, args: SqliteValue[]): number
  batch(operations: NitromelonBatchOperation[]): void
  // Powers Query#markAllAsDeleted()/destroyAllPermanently(): `sql`/`args` are the exact same
  // query that would otherwise be used for `queryIds()`. Collects the matching ids, then --
  // unless `isUnconditional` (no where/join/take/skip at all, i.e. "the whole table"), in which
  // case it skips straight to an unconditional delete/update to unlock SQLite's own truncate
  // optimization -- deletes/marks-deleted those exact rows by reusing `sql`/`args` again as an
  // inline subquery, all in one transaction. Returns the ids that were actually affected.
  destroyMatching(
    table: string,
    sql: string,
    args: SqliteValue[],
    permanently: boolean,
    isUnconditional: boolean,
  ): string[]
  batchJSON(operations: string): void
  getLocal(key: string): NitromelonLocalValue
  unsafeLoadFromSync(jsonId: number, schema: AnyMap, preamble: string, postamble: string): AnyMap
  unsafeExecuteMultiple(sql: string): void
  unsafeResetDatabase(schema: string, schemaVersion: number): void
  unsafeClose(): void
  // Registers a callback invoked when the OS signals critical memory
  // pressure, so JS-side caches can proactively trim already-dead entries.
  onMemoryWarning(callback: () => void): void
  // SQLiteAdapter's `encryption` option. Must come before any other call: the connection opens on
  // first use. `passphrase` '' means none. Opening throws `[code] message` errors (see
  // native/shared/SqliteEncryption.h), never changing the file.
  setEncryption(passphrase: string, allowUnencrypted: boolean): void
  // Whether the open connection is encrypted
  isEncrypted(): boolean
  // Encrypts, re-keys or ('' ) decrypts in place, on a background thread. Every other call waits
  // for it (the native mutex), so JS holds them back meanwhile (see SQLiteAdapter).
  changeEncryptionKey(newPassphrase: string): Promise<void>
}

export interface Nitromelon extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  createAdapter(dbName: string, usesExclusiveLocking: boolean): NitromelonDatabase
  provideSyncJson(id: number, json: string): void
  getRandomIds(): string
  // Whether this build has the codec ("nitromelondb": { "encryption": true } in the app's
  // package.json). See docs/Advanced/Encryption.
  isEncryptionAvailable(): boolean
  // 'encrypted' | 'unencrypted' | 'missing', from the file's first bytes. Never opens SQLite.
  getDatabaseEncryptionState(dbName: string): string
}
