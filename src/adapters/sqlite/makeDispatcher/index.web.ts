import defaultWasmAsset from '../sqlite-wasm/wa-sqlite-async.wasm'

import type { ConnectionTag } from '../../../utils/common'
import type { ResultCallback } from '../../../utils/fp/Result'
import type {
  DispatcherType,
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
