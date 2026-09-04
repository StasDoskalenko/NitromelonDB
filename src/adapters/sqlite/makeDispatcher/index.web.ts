import defaultWasmAsset from '../sqlite-wasm/wa-sqlite-async.wasm'

import type { ConnectionTag } from '../../../utils/common'
import type { ResultCallback } from '../../../utils/fp/Result'
import type {
  DispatcherType,
  InitializeStatus,
  SQLiteAdapterOptions,
  SQLiteWebOptions,
  SqliteDispatcher,
  SqliteDispatcherMethod,
  SqliteDispatcherOptions,
} from '../type'
import type { WorkerRequest, WorkerResponse } from '../sqlite-wasm/protocol'
import { deserializeError } from '../sqlite-wasm/protocol'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

class WorkerClient {
  worker: Worker
  wasmUrl: string
  nextRequestId = 1
  pending = new Map<number, PendingRequest>()
  fatalError?: Error | undefined

  constructor(worker: Worker, wasmUrl: string) {
    this.worker = worker
    this.wasmUrl = wasmUrl
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id)
      if ('error' in response) pending.reject(deserializeError(response.error))
      else pending.resolve(response.value)
    })
    worker.addEventListener('error', (event) => {
      this.fail(new Error(event.message || 'NitromelonDB wa-sqlite worker crashed'))
    })
    worker.addEventListener('messageerror', () => {
      this.fail(new Error('NitromelonDB wa-sqlite worker returned an unreadable message'))
    })
  }

  request(tag: ConnectionTag, method: SqliteDispatcherMethod, args: unknown[]): Promise<unknown> {
    if (this.fatalError) return Promise.reject(this.fatalError)
    const id = this.nextRequestId
    this.nextRequestId += 1
    const request: WorkerRequest = { id, tag, method, args, wasmUrl: this.wasmUrl }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.worker.postMessage(request)
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  fail(error: Error): void {
    if (this.fatalError) return
    this.fatalError = error
    this.pending.forEach(({ reject }) => reject(error))
    this.pending.clear()
    this.worker.terminate()
  }
}

const defaultClients = new Map<string, WorkerClient>()
const customClients = new WeakMap<() => Worker, Map<string, WorkerClient>>()

function packagedWorker(): Worker {
  if (typeof Worker === 'undefined') {
    throw new Error('NitromelonDB wa-sqlite requires Web Workers in the browser')
  }
  return new Worker(new URL('./wa-sqlite.worker', window.location.href))
}

function absoluteUrl(url: string): string {
  return new URL(url, window.location.href).href
}

function resolveDefaultWasmUrl(): string {
  if (typeof defaultWasmAsset === 'string') return absoluteUrl(defaultWasmAsset)
  if (typeof defaultWasmAsset === 'object' && defaultWasmAsset.uri) {
    return absoluteUrl(defaultWasmAsset.uri)
  }
  const stringValue = String(defaultWasmAsset)
  if (stringValue && stringValue !== '[object Object]') return absoluteUrl(stringValue)
  throw new Error(
    'NitromelonDB could not resolve wa-sqlite-async.wasm. Pass SQLiteAdapter { web: { wasmUrl } }.',
  )
}

function clientFor(options: SQLiteWebOptions | undefined): WorkerClient {
  const wasmUrl = options?.wasmUrl ? absoluteUrl(options.wasmUrl) : resolveDefaultWasmUrl()
  const factory = options?.workerFactory
  if (!factory) {
    let client = defaultClients.get(wasmUrl)
    if (!client || client.fatalError) {
      client = new WorkerClient(packagedWorker(), wasmUrl)
      defaultClients.set(wasmUrl, client)
    }
    return client
  }
  let clients = customClients.get(factory)
  if (!clients) {
    clients = new Map()
    customClients.set(factory, clients)
  }
  let client = clients.get(wasmUrl)
  if (!client || client.fatalError) {
    client = new WorkerClient(factory(), wasmUrl)
    clients.set(wasmUrl, client)
  }
  return client
}

class WaSQLiteDispatcher implements SqliteDispatcher {
  tag: ConnectionTag
  webOptions?: SQLiteWebOptions | undefined
  isServer: boolean
  setupState: 'initializing' | 'setting-up' | 'ready' | 'failed' = 'initializing'
  setupError?: Error | undefined
  queuedCalls: Array<{
    method: SqliteDispatcherMethod
    args: unknown[]
    callback: ResultCallback<unknown>
  }> = []

  constructor(tag: ConnectionTag, webOptions?: SQLiteWebOptions | undefined) {
    this.tag = tag
    this.webOptions = webOptions
    this.isServer = typeof window === 'undefined'
  }

  call<T>(method: SqliteDispatcherMethod, args: unknown[], callback: ResultCallback<T>): void {
    if (this.isServer) {
      if (method === 'initialize') callback({ value: { code: 'ok' } as T })
      else {
        callback({
          error: new Error(
            'NitromelonDB SQLite is client-only on web. Use the authoritative server database during SSR.',
          ),
        })
      }
      return
    }
    if (method === 'initialize') {
      this.send<InitializeStatus>(method, args, (result) => {
        if (result.error) {
          this.failSetup(result.error)
        } else if (result.value.code === 'ok') {
          this.setupState = 'ready'
        } else {
          this.setupState = 'setting-up'
        }
        callback(result as Parameters<ResultCallback<T>>[0])
        if (this.setupState === 'ready') this.flushQueuedCalls()
      })
      return
    }
    if (method === 'setUpWithSchema' || method === 'setUpWithMigrations') {
      this.send<void>(method, args, (result) => {
        if (result.error) {
          this.failSetup(result.error)
        } else {
          this.setupState = 'ready'
        }
        callback(result as Parameters<ResultCallback<T>>[0])
        if (this.setupState === 'ready') this.flushQueuedCalls()
      })
      return
    }
    if (this.setupState === 'failed') {
      callback({ error: this.setupError ?? new Error('wa-sqlite adapter setup failed') })
      return
    }
    if (this.setupState !== 'ready') {
      this.queuedCalls.push({
        method,
        args,
        callback: callback as ResultCallback<unknown>,
      })
      return
    }
    this.send(method, args, callback)
  }

  send<T>(method: SqliteDispatcherMethod, args: unknown[], callback: ResultCallback<T>): void {
    let client: WorkerClient
    try {
      client = clientFor(this.webOptions)
    } catch (error) {
      callback({ error: error instanceof Error ? error : new Error(String(error)) })
      return
    }
    client.request(this.tag, method, args).then(
      (value) => callback({ value: value as T }),
      (error) => callback({ error: error instanceof Error ? error : new Error(String(error)) }),
    )
  }

  failSetup(error: Error): void {
    this.setupState = 'failed'
    this.setupError = error
    const queued = this.queuedCalls
    this.queuedCalls = []
    queued.forEach(({ callback }) => callback({ error }))
  }

  flushQueuedCalls(): void {
    const queued = this.queuedCalls
    this.queuedCalls = []
    queued.forEach(({ method, args, callback }) => this.send(method, args, callback))
  }
}

export const makeDispatcher = (
  _type: DispatcherType,
  tag: ConnectionTag,
  _dbName: string,
  options: SqliteDispatcherOptions,
): SqliteDispatcher => {
  if (options.usesExclusiveLocking) {
    throw new Error('SQLiteAdapter usesExclusiveLocking is not supported by wa-sqlite on web')
  }
  return new WaSQLiteDispatcher(tag, options.web)
}

export function getDispatcherType(_options: SQLiteAdapterOptions): DispatcherType {
  return 'wa-sqlite'
}
