import type { AppSchema, TableName } from '../../Schema'
import type { SchemaMigrations } from '../../Schema/migrations'
import type { DirtyRaw } from '../../RawRecord'

export type LokiRawDocument = {
  [key: string]: unknown
}

export type LokiQueryObject = {
  [key: string]: unknown
}

export type LokiResultset = {
  find: (query?: LokiQueryObject | undefined) => LokiResultset
  data: () => LokiRawDocument[]
  compoundsort: (sorts: Array<[string, boolean]>) => LokiResultset
  offset: (skip: number) => LokiResultset
  limit: (take: number) => LokiResultset
  count: () => number
}

export type LokiCollection = {
  chain: () => LokiResultset
  by: (field: string, value: unknown) => LokiRawDocument | undefined
  insert: (docs: LokiRawDocument[] | LokiRawDocument, skipIndexRebuild?: boolean) => unknown
  update: (doc: LokiRawDocument) => unknown
  remove: (doc: LokiRawDocument) => unknown
  find: (query: LokiQueryObject) => LokiRawDocument[]
  findAndUpdate: (query: LokiQueryObject, updateFn: (doc: LokiRawDocument) => void) => unknown
  ensureIndex: (field: string) => void
  data: LokiRawDocument[]
}

export type LokiCollectionOptions = {
  unique?: string[] | undefined
  indices?: string[] | undefined
  disableMeta?: boolean | undefined
}

export type LokiMemoryAdapter = {
  [key: string]: unknown
}

export type Loki = {
  getCollection: (name: string) => LokiCollection
  addCollection: (name: string, options?: LokiCollectionOptions | undefined) => LokiCollection
  close: (callback?: (() => void) | undefined) => void
  loadDatabase: (
    options: { [key: string]: unknown },
    callback: (error?: Error | null | undefined) => void,
  ) => void
  deleteDatabase: (options: { [key: string]: unknown }, callback: (response?: unknown) => void) => void
  save?: (() => void) | undefined
  saveDatabase?: (() => void) | undefined
  saveDatabaseInternal?: (() => void) | undefined
  autosave: boolean
  autosaveDisable: () => void
  persistenceAdapter?: LokiMemoryAdapter | undefined
}

export type LokiAdapterOptions = {
  dbName?: string | null | undefined
  schema: AppSchema
  migrations?: SchemaMigrations | undefined
  // (true by default) Although web workers may have some throughput benefits, disabling them
  // may lead to lower memory consumption, lower latency, and easier debugging
  useWebWorker?: boolean | undefined
  useIncrementalIndexedDB?: boolean | undefined
  // Called when database failed to set up (initialize) correctly. It's possible that
  // it's some transient IndexedDB error that will be solved by a reload, but it's
  // very likely that the error is persistent (e.g. a corrupted database).
  // Pass a callback to offer to the user to reload the app or log out
  onSetUpError?: ((error: Error) => void) | undefined
  // Called when underlying IndexedDB encountered a quota exceeded error (ran out of allotted disk space for app)
  // This means that app can't save more data or that it will fall back to using in-memory database only
  // Note that this only works when `useWebWorker: false`
  onQuotaExceededError?: ((error: Error) => void) | undefined
  // extra options passed to Loki constructor
  extraLokiOptions?:
    | {
        autosave?: boolean | undefined
        autosaveInterval?: number | undefined
      }
    | undefined
  // extra options passed to IncrementalIDBAdapter constructor
  extraIncrementalIDBOptions?:
    | {
        // Called when this adapter is forced to overwrite contents of IndexedDB.
        // This happens if there's another open tab of the same app that's making changes.
        // You might use it as an opportunity to alert user to the potential loss of data
        onDidOverwrite?: (() => void) | undefined
        // Called when internal IndexedDB version changed (most likely the database was deleted in another browser tab)
        // Pass a callback to force log out in this copy of the app as well
        // (Due to a race condition, it's usually best to just reload the web app)
        // Note that this only works when not using web workers
        onversionchange?: (() => void) | undefined
        // Called with a chunk (array of Loki documents) before it's saved to IndexedDB/loaded from IDB. You can use it to
        // manually compress on-disk representation for faster database loads.
        // Hint: Hand-written conversion of objects to arrays is very profitable for performance.
        // Note that this only works when not using web workers
        serializeChunk?: ((table: TableName, chunk: DirtyRaw[]) => unknown) | undefined
        deserializeChunk?: ((table: TableName, chunk: unknown) => DirtyRaw[]) | undefined
        // Called when IndexedDB fetch has begun. Use this as an opportunity to execute code concurrently
        // while IDB does work on a separate thread.
        // Note that this only works when not using web workers
        onFetchStart?: (() => void) | undefined
        // Collections (by table name) that Loki should deserialize lazily. This is only profitable for
        // collections that are most likely not required for launch - making everything lazy makes it slower
        lazyCollections?: TableName[] | undefined
      }
    | undefined
  // -- internal --
  _testLokiAdapter?: LokiMemoryAdapter | undefined
  _onFatalError?: ((error: Error) => void) | undefined // (experimental)
  _betaLoki?: boolean | undefined // (experimental)
}
