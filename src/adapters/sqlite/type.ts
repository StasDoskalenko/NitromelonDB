import type { ResultCallback } from '../../utils/fp/Result'

import type { AppSchema, TableName, SchemaVersion } from '../../Schema'
import type { SchemaMigrations } from '../../Schema/migrations'

export type SQL = string
export type SQLiteArg = string | boolean | number | null
export type SQLiteQuery = [SQL, SQLiteArg[]]

export type MigrationEvents = {
  onSuccess: () => void
  onStart: () => void
  onError: (error: Error) => void
}

// A passphrase, or a function that gets one (from the Keychain/Keystore, a biometric prompt, a
// server...). A function is called once, when the adapter is created; every database call waits
// for it. It must return a passphrase: an empty one or null is an error, never "open unencrypted".
export type EncryptionPassphrase =
  string | (() => string | null | undefined) | (() => Promise<string | null | undefined>)

export type EncryptionOperation = 'encrypt' | 'decrypt' | 'rekey'

export type EncryptionEvents = {
  // Before database.unsafe_EncryptDB()/unsafe_DecryptDB() changes the file. It can take a while on
  // a big database (it rewrites every page): show something
  onStart?:
    | ((info: { operation: EncryptionOperation; pageCount: number; byteSize: number }) => void)
    | undefined
  onSuccess?: ((info: { operation: EncryptionOperation; durationMs: number }) => void) | undefined
  onError?: ((error: Error) => void) | undefined
}

export type EncryptionOptions = {
  passphrase: EncryptionPassphrase
  // When the database on disk isn't encrypted although a passphrase is given:
  // 'error' (default): setup fails with code 'database_not_encrypted'.
  // 'open': opens it unencrypted, so the app can encrypt it with database.unsafe_EncryptDB().
  // New databases are always created encrypted.
  ifUnencrypted?: 'error' | 'open' | undefined
  events?: EncryptionEvents | undefined
}

// error.code of errors from opening or re-keying an encrypted database
export type EncryptionErrorCode =
  | 'encryption_unavailable'
  | 'encryption_key_invalid'
  | 'encryption_key_required'
  | 'database_not_encrypted'
  | 'rekey_failed'

export type DatabaseEncryptionState = 'encrypted' | 'unencrypted' | 'missing'

export type SQLiteAdapterOptions = {
  dbName?: string | undefined
  schema: AppSchema
  migrations?: SchemaMigrations | undefined
  // Ignored on React Native (always Nitro: iOS, Android, Windows New Architecture).
  // `{ jsi: false }` is rejected — NativeModules SQLite interop is gone.
  jsi?: boolean | undefined
  migrationEvents?: MigrationEvents | undefined
  // Called when database failed to set up (initialize) correctly. It's possible that
  // it's some transient error that will be solved by a reload, but it's
  // very likely that the error is persistent (e.g. a corrupted database).
  // Pass a callback to offer to the user to reload the app or log out
  onSetUpError?: ((error: Error) => void) | undefined
  // (JSI only) Sets exclusive file locking mode in sqlite. Use this ONLY if you need to - e.g. seems to fix
  // mysterious "database is malformed" issues on JSI+Android when using Headless JS
  usesExclusiveLocking?: boolean | undefined
  // (iOS, Android, Windows, Node) Store whole numbers as SQLite INTEGER instead of REAL: smaller
  // rows and faster queries that scan or sort number columns (about 10% in the benchmarks). Numbers
  // already stored are converted once, in the background without delaying launch, and converted
  // back if the option is turned off again. Off by default, because
  // raw SQL can see the difference: `/` between two whole numbers truncates (`7 / 2` is `3`),
  // turning one into text gives '42' instead of '42.0', and typeof() returns 'integer'. Queries
  // built with Q, models and sync behave the same. Turn it on if your raw SQL (Q.unsafeSqlQuery,
  // Q.unsafeSqlExpr, unsafeExecute) doesn't do arithmetic or text operations on number columns;
  // development builds warn about raw SQL that might. See docs/Advanced/Performance.
  storeWholeNumbersAsIntegers?: boolean | undefined
  // Deprecated: Android NativeModule-only. Ignored; SQLite no longer uses NativeModules.
  experimentalUnsafeNativeReuse?: boolean | undefined
  // Browser-only wa-sqlite configuration. Expo Metro uses the packaged worker and
  // WASM asset automatically; these hooks support custom asset hosting/bundlers.
  web?: SQLiteWebOptions | undefined
  // Encrypts the database (SQLCipher 4 format). Needs the encryption build: "nitromelondb":
  // { "encryption": true } in the app's package.json (on Node and Electron,
  // better-sqlite3-multiple-ciphers installed). See docs/Encryption/Intro.
  encryption?: EncryptionOptions | undefined
}

export type SQLiteWebOptions = {
  wasmUrl?: string | undefined
  workerFactory?: (() => Worker) | undefined
}

export type DispatcherType = 'nitro' | 'jsi' | 'asynchronous' | 'wa-sqlite'

// This is the internal format of batch operations
// It's ugly, but optimized for performance and versatility, e.g.:
// adding a record:  [1, 'table', 'insert into...', [['id', 'created', ...]]]
// updating a record [0, null, 'update...', [['id', 'created', ...]]]
// removing a record [-1, table, 'delete...', [['id', 'created', ...]]]
type NativeBridgeBatchOperationCacheBehavior =
  | -1 // remove from cache
  | 0 // ignore
  | 1 // add to cache
export type NativeBridgeBatchOperation = [
  NativeBridgeBatchOperationCacheBehavior,
  TableName | null, // table to add/remove from cache
  SQL,
  Array<SQLiteArg[]>, // id must be at [0] if cacheBehavior != 0
]

export type InitializeStatus =
  { code: 'ok' | 'schema_needed' } | { code: 'migrations_needed'; databaseVersion: SchemaVersion }

export type SyncReturn<T> =
  { status: 'success'; result: T } | { status: 'error'; code: string; message: string }

export type SqliteDispatcherOptions = {
  usesExclusiveLocking: boolean
  // '' = not encrypted
  passphrase?: string | undefined
  allowUnencrypted?: boolean | undefined
  storeWholeNumbersAsIntegers: boolean
  experimentalUnsafeNativeReuse: boolean
  web?: SQLiteWebOptions | undefined
}

export type SqliteDispatcherMethod =
  | 'initialize'
  | 'setUpWithSchema'
  | 'setUpWithMigrations'
  | 'find'
  | 'query'
  | 'queryIds'
  | 'unsafeQueryRaw'
  | 'count'
  | 'batch'
  | 'destroyMatching'
  | 'unsafeLoadFromSync'
  | 'provideSyncJson'
  | 'unsafeResetDatabase'
  | 'getLocal'
  | 'unsafeExecuteMultiple'
  // Native only (encryption)
  | 'isEncrypted'
  | 'changeEncryptionKey'
  // Node/Electron only (see sqlite-node/DatabaseBridge). Native (iOS/Android/
  // Windows Nitro) has no connection lifecycle for JS to manage — the app
  // process owns it — so this is not implemented there.
  | 'unsafeCloseConnection'

export interface SqliteDispatcher {
  call<T>(methodName: SqliteDispatcherMethod, args: unknown[], callback: ResultCallback<T>): void
}
