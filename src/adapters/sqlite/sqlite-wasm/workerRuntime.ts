import SQLiteESMFactory from './wa-sqlite-async.mjs'
import * as SQLite from 'wa-sqlite'
import { IDBBatchAtomicVFS } from 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js'

import type { NativeBridgeBatchOperation, SQLiteArg } from '../type'
import DatabaseDriver, { type SQLiteAPI } from './DatabaseDriver'
import type { WorkerRequest, WorkerResponse } from './protocol'
import { serializeError } from './protocol'

type WorkerScope = {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ) => void
  postMessage: (message: WorkerResponse) => void
}

type Runtime = {
  sqlite3: SQLiteAPI
  module: object
  cacheChannel: BroadcastChannel
}

type DatabaseEntry = {
  driver: DatabaseDriver
  vfs: IDBBatchAtomicVFS
  references: number
}

type Connection = {
  driver: DatabaseDriver
  databaseKey: string
  database: DatabaseEntry
}

type CacheInvalidationMessage = {
  databaseKey: string
  source: string
}

const connections = new Map<number, Connection>()
const databases = new Map<string, DatabaseEntry>()
const syncJsons = new Map<number, Map<number, string>>()
let runtimePromise: Promise<Runtime> | undefined
let configuredWasmUrl: string | undefined
const workerInstanceId =
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const cacheChannelName = 'nitromelondb-wa-sqlite-cache-v1'

function databaseKey(dbName: string): string {
  return `nitromelondb-${encodeURIComponent(dbName)}`
}

async function createRuntime(wasmUrl: string): Promise<Runtime> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('NitromelonDB wa-sqlite requires IndexedDB in the browser')
  }
  if (!globalThis.navigator?.locks) {
    throw new Error('NitromelonDB wa-sqlite requires the Web Locks API in the browser')
  }
  if (typeof BroadcastChannel === 'undefined') {
    throw new Error('NitromelonDB wa-sqlite requires BroadcastChannel for multi-tab cache safety')
  }
  const response = await fetch(wasmUrl)
  if (!response.ok) {
    throw new Error(`Failed to load wa-sqlite WASM (${response.status} ${response.statusText})`)
  }
  const wasmBinary = new Uint8Array(await response.arrayBuffer())
  // Metro rewrites `import.meta` inside worker chunks. Supplying locateFile as
  // well as wasmBinary keeps Emscripten from evaluating its fallback URL.
  const module = (await SQLiteESMFactory({ wasmBinary, locateFile: () => wasmUrl })) as object
  const sqlite3 = SQLite.Factory(module) as unknown as SQLiteAPI
  const cacheChannel = new BroadcastChannel(cacheChannelName)
  cacheChannel.addEventListener('message', (event: MessageEvent<CacheInvalidationMessage>) => {
    const message = event.data
    if (message?.source !== workerInstanceId && typeof message?.databaseKey === 'string') {
      invalidateConnections(message.databaseKey)
    }
  })
  return { sqlite3, module, cacheChannel }
}

async function createDatabaseEntry(runtime: Runtime, key: string): Promise<DatabaseEntry> {
  if (typeof IDBBatchAtomicVFS.create !== 'function') {
    throw new Error(
      'The pinned wa-sqlite IDBBatchAtomicVFS API is incompatible: static create() is unavailable',
    )
  }
  const vfs = await IDBBatchAtomicVFS.create(key, runtime.module, { idbName: key })
  if (typeof vfs.close !== 'function') {
    throw new Error(
      'The pinned wa-sqlite IDBBatchAtomicVFS API is incompatible: close() is unavailable',
    )
  }
  runtime.sqlite3.vfs_register(vfs)
  let db: number
  try {
    db = await runtime.sqlite3.open_v2('/nitromelondb.db', undefined, vfs.name)
  } catch (error) {
    vfs.close()
    throw error
  }
  const driver = new DatabaseDriver(runtime.sqlite3, db)
  try {
    await driver.configure()
  } catch (error) {
    try {
      await driver.close()
    } finally {
      vfs.close()
    }
    throw error
  }
  return { driver, vfs, references: 0 }
}

function invalidateConnections(databaseKeyToInvalidate: string, exceptTag?: number): void {
  const exceptDriver = exceptTag === undefined ? undefined : connections.get(exceptTag)?.driver
  connections.forEach((connection, tag) => {
    if (
      tag !== exceptTag &&
      connection.driver !== exceptDriver &&
      connection.databaseKey === databaseKeyToInvalidate
    ) {
      connection.driver.clearCachedRecords()
    }
  })
}

function publishInvalidation(runtime: Runtime, databaseKeyToInvalidate: string): void {
  runtime.cacheChannel.postMessage({
    databaseKey: databaseKeyToInvalidate,
    source: workerInstanceId,
  } satisfies CacheInvalidationMessage)
}

function invalidateAfterMutation(
  runtime: Runtime,
  tag: number,
  databaseKeyToInvalidate: string,
  preserveSourceCache: boolean,
): void {
  invalidateConnections(databaseKeyToInvalidate, preserveSourceCache ? tag : undefined)
  publishInvalidation(runtime, databaseKeyToInvalidate)
}

function getRuntime(wasmUrl: string | undefined): Promise<Runtime> {
  if (!wasmUrl) {
    throw new Error('NitromelonDB could not resolve the wa-sqlite WASM asset URL')
  }
  if (configuredWasmUrl && configuredWasmUrl !== wasmUrl) {
    throw new Error('The shared wa-sqlite worker cannot use more than one WASM URL')
  }
  configuredWasmUrl = wasmUrl
  if (!runtimePromise) {
    runtimePromise = createRuntime(wasmUrl).catch((error: unknown) => {
      runtimePromise = undefined
      configuredWasmUrl = undefined
      throw error
    })
  }
  return runtimePromise
}

function connectionFor(tag: number): Connection {
  const connection = connections.get(tag)
  if (!connection) {
    throw new Error(`No wa-sqlite driver with tag ${tag} is available`)
  }
  return connection
}

async function disposeConnection(tag: number, connection: Connection): Promise<void> {
  connections.delete(tag)
  syncJsons.delete(tag)
  const { database } = connection
  database.references = Math.max(0, database.references - 1)
  if (database.references) return
  databases.delete(connection.databaseKey)
  try {
    await database.driver.close()
  } finally {
    database.vfs.close()
  }
}

async function dispatch(request: WorkerRequest): Promise<unknown> {
  const { tag, method, args } = request
  if (method === 'initialize') {
    if (connections.has(tag)) {
      throw new Error(`A wa-sqlite driver with tag ${tag} is already set up`)
    }
    const runtime = await getRuntime(request.wasmUrl)
    const dbName = String(args[0])
    const key = databaseKey(dbName)
    let database = databases.get(key)
    if (!database) {
      database = await createDatabaseEntry(runtime, key)
      databases.set(key, database)
    }
    database.references += 1
    // SQL handles are shared per logical database in this worker, but record
    // caches are per adapter tag because each adapter has its own JS model cache.
    const driver = new DatabaseDriver(runtime.sqlite3, database.driver.db)
    const connection = { driver, databaseKey: key, database }
    connections.set(tag, connection)
    try {
      return await driver.initialize(Number(args[1]))
    } catch (error) {
      try {
        await disposeConnection(tag, connection)
      } catch {
        // Preserve the initialization error while releasing the tag reference.
      }
      throw error
    }
  }

  if (method === 'provideSyncJson') {
    let providedJsons = syncJsons.get(tag)
    if (!providedJsons) {
      providedJsons = new Map()
      syncJsons.set(tag, providedJsons)
    }
    providedJsons.set(Number(args[0]), String(args[1]))
    return undefined
  }

  const runtime = await getRuntime(request.wasmUrl)
  const connection = connectionFor(tag)
  const { driver, databaseKey: connectionKey } = connection
  switch (method) {
    case 'setUpWithSchema': {
      try {
        const result = await driver.setUpWithSchema(String(args[1]), Number(args[2]))
        invalidateAfterMutation(runtime, tag, connectionKey, false)
        return result
      } catch (error) {
        try {
          await disposeConnection(tag, connection)
        } catch {
          // Preserve the schema setup error while still releasing worker-owned resources.
        }
        throw error
      }
    }
    case 'setUpWithMigrations': {
      try {
        const result = await driver.setUpWithMigrations({
          sql: String(args[1]),
          from: Number(args[2]),
          to: Number(args[3]),
        })
        invalidateAfterMutation(runtime, tag, connectionKey, false)
        return result
      } catch (error) {
        try {
          await disposeConnection(tag, connection)
        } catch {
          // Preserve the migration error while still releasing worker-owned resources.
        }
        throw error
      }
    }
    case 'find':
      return driver.find(String(args[0]), String(args[1]))
    case 'query':
      return driver.cachedQuery(String(args[0]), String(args[1]), args[2] as SQLiteArg[])
    case 'queryIds':
      return driver.queryIds(String(args[0]), args[1] as SQLiteArg[])
    case 'unsafeQueryRaw':
      return driver.queryRaw(String(args[0]), args[1] as SQLiteArg[])
    case 'count':
      return driver.count(String(args[0]), args[1] as SQLiteArg[])
    case 'batch': {
      const result = await driver.batch(args[0] as NativeBridgeBatchOperation[])
      invalidateAfterMutation(runtime, tag, connectionKey, true)
      return result
    }
    case 'unsafeLoadFromSync': {
      const jsonId = Number(args[0])
      const providedJsons = syncJsons.get(tag)
      const json = providedJsons?.get(jsonId)
      if (json === undefined) {
        throw new Error(`Sync json ${jsonId} does not exist`)
      }
      try {
        const result = await driver.unsafeLoadFromSync(
          json,
          args[1] as Parameters<DatabaseDriver['unsafeLoadFromSync']>[1],
          String(args[2]),
          String(args[3]),
        )
        invalidateAfterMutation(runtime, tag, connectionKey, false)
        return result
      } finally {
        providedJsons?.delete(jsonId)
        if (!providedJsons?.size) {
          syncJsons.delete(tag)
        }
      }
    }
    case 'unsafeResetDatabase': {
      const result = await driver.unsafeResetDatabase({
        sql: String(args[0]),
        version: Number(args[1]),
      })
      invalidateAfterMutation(runtime, tag, connectionKey, false)
      return result
    }
    case 'getLocal':
      return driver.getLocal(String(args[0]))
    case 'unsafeExecuteMultiple': {
      const result = await driver.executeStatements(String(args[0]))
      invalidateAfterMutation(runtime, tag, connectionKey, false)
      return result
    }
    case 'unsafeCloseConnection':
      await disposeConnection(tag, connection)
      return undefined
    default:
      throw new Error(`Unsupported wa-sqlite dispatcher method ${method}`)
  }
}

export function startNitromelonWebWorker(scope: WorkerScope): void {
  let operationQueue = Promise.resolve()
  scope.addEventListener('message', (event) => {
    const request = event.data
    operationQueue = operationQueue.then(async () => {
      try {
        const value = await dispatch(request)
        scope.postMessage({ id: request.id, value })
      } catch (error) {
        scope.postMessage({ id: request.id, error: serializeError(error) })
      }
    })
  })
}
