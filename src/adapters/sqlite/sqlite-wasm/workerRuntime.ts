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
  vfsByDatabase: Map<string, VfsEntry>
  cacheChannel: BroadcastChannel
}

type VfsEntry = {
  vfs: IDBBatchAtomicVFS
  references: number
}

type Connection = {
  driver: DatabaseDriver
  databaseKey: string
}

type CacheInvalidationMessage = {
  databaseKey: string
  source: string
}

const connections = new Map<number, Connection>()
const syncJsons = new Map<number, string>()
let runtimePromise: Promise<Runtime> | undefined
let configuredWasmUrl: string | undefined
const workerInstanceId = `${Date.now()}-${Math.random()}`
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
  // well as wasmBinary keeps Emscripten from evaluating its import.meta.url
  // fallback before it notices the already-fetched binary.
  const module = (await SQLiteESMFactory({ wasmBinary, locateFile: () => wasmUrl })) as object
  const sqlite3 = SQLite.Factory(module) as unknown as SQLiteAPI
  const cacheChannel = new BroadcastChannel(cacheChannelName)
  cacheChannel.addEventListener('message', (event: MessageEvent<CacheInvalidationMessage>) => {
    const message = event.data
    if (message?.source !== workerInstanceId && typeof message?.databaseKey === 'string') {
      invalidateConnections(message.databaseKey)
    }
  })
  return { sqlite3, module, vfsByDatabase: new Map(), cacheChannel }
}

async function vfsFor(runtime: Runtime, dbName: string): Promise<[string, VfsEntry]> {
  const key = databaseKey(dbName)
  let entry = runtime.vfsByDatabase.get(key)
  if (!entry) {
    const vfs = await IDBBatchAtomicVFS.create(key, runtime.module, { idbName: key })
    runtime.sqlite3.vfs_register(vfs)
    entry = { vfs, references: 0 }
    runtime.vfsByDatabase.set(key, entry)
  }
  return [key, entry]
}

function releaseVfs(runtime: Runtime, key: string): void {
  const entry = runtime.vfsByDatabase.get(key)
  if (!entry) return
  entry.references = Math.max(0, entry.references - 1)
  if (entry.references === 0) {
    entry.vfs.close()
    runtime.vfsByDatabase.delete(key)
  }
}

function invalidateConnections(databaseKeyToInvalidate: string, exceptTag?: number): void {
  connections.forEach((connection, tag) => {
    if (tag !== exceptTag && connection.databaseKey === databaseKeyToInvalidate) {
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

async function disposeConnection(
  runtime: Runtime,
  tag: number,
  connection: Connection,
): Promise<void> {
  try {
    await connection.driver.close()
  } finally {
    connections.delete(tag)
    releaseVfs(runtime, connection.databaseKey)
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
    const [key, entry] = await vfsFor(runtime, dbName)
    let db: number
    try {
      db = await runtime.sqlite3.open_v2('/nitromelondb.db', undefined, entry.vfs.name)
    } catch (error) {
      // vfsFor() may have created this VFS for the failed open. It has no owner yet.
      if (entry.references === 0) {
        entry.vfs.close()
        runtime.vfsByDatabase.delete(key)
      }
      throw error
    }
    entry.references += 1
    const driver = new DatabaseDriver(runtime.sqlite3, db)
    try {
      await driver.configure()
      connections.set(tag, { driver, databaseKey: key })
      return driver.initialize(Number(args[1]))
    } catch (error) {
      try {
        await driver.close()
      } finally {
        releaseVfs(runtime, key)
      }
      throw error
    }
  }

  if (method === 'provideSyncJson') {
    syncJsons.set(Number(args[0]), String(args[1]))
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
          await disposeConnection(runtime, tag, connection)
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
          await disposeConnection(runtime, tag, connection)
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
      const json = syncJsons.get(jsonId)
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
        syncJsons.delete(jsonId)
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
      await disposeConnection(runtime, tag, connection)
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
