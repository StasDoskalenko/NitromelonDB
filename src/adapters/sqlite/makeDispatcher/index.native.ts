/* eslint-disable global-require */

import { logger, invariant, type ConnectionTag } from '../../../utils/common'
import type { ResultCallback } from '../../../utils/fp/Result'
import type { Nitromelon, NitromelonDatabase } from '../../../nitro/Nitromelon.nitro'
import type {
  DispatcherType,
  SQLiteAdapterOptions,
  SqliteDispatcher,
  SqliteDispatcherMethod,
  SqliteDispatcherOptions,
} from '../type'

type NativeDatabase = {
  [methodName: string]: ((...args: unknown[]) => unknown) | undefined
}

type SchemaColumn = { name: string; type: string; isOptional?: boolean | undefined }
type SchemaTable = { columnArray: SchemaColumn[] }

function nitroSyncSchema(schema: unknown): { tables: Record<string, SchemaTable> } {
  const tablesIn = (schema as { tables: Record<string, SchemaTable> }).tables
  const tables: Record<string, SchemaTable> = {}
  Object.keys(tablesIn).forEach((name) => {
    tables[name] = {
      columnArray: tablesIn[name].columnArray.map((column) => ({
        name: column.name,
        type: column.type,
        ...(column.isOptional === true ? { isOptional: true } : {}),
      })),
    }
  })
  return { tables }
}

let cachedNitromelon: Nitromelon | null | undefined

function nitromelonOrNull(): Nitromelon | null {
  if (cachedNitromelon !== undefined) {
    return cachedNitromelon
  }

  try {
    // `/index` is required: Metro prefers package-root `nitro.json` over `nitro/index.js`.
    const nitroModule = require('../../../nitro/index') as { nitromelon: Nitromelon }
    if (typeof nitroModule.nitromelon?.createAdapter !== 'function') {
      cachedNitromelon = null
      return null
    }
    cachedNitromelon = nitroModule.nitromelon
    return nitroModule.nitromelon
  } catch (error) {
    logger.warn(
      '[SQLite] Failed to load Nitromelon HybridObject. If the next error says to install react-native-nitro-modules, this is the underlying cause:',
      error,
    )
    cachedNitromelon = null
    return null
  }
}

class SqliteSyncDispatcher implements SqliteDispatcher {
  _db: NitromelonDatabase | NativeDatabase
  _nitro: Nitromelon
  _unsafeErrorListener: (error: Error) => void

  constructor(dbName: string, { usesExclusiveLocking }: SqliteDispatcherOptions) {
    this._unsafeErrorListener = () => {}
    const nitro = nitromelonOrNull()
    invariant(
      nitro,
      'SQLiteAdapter could not create a native database. Install react-native-nitro-modules and rebuild.',
    )
    this._nitro = nitro
    this._db = nitro.createAdapter(dbName, usesExclusiveLocking)
  }

  call<T>(name: SqliteDispatcherMethod, _args: unknown[], callback: ResultCallback<T>): void {
    let methodName: string = name
    let args = _args

    if (methodName === 'query' && !global.HermesInternal) {
      methodName = 'queryAsArray'
    } else if (methodName === 'batch') {
      methodName = 'batchJSON'
      args = [JSON.stringify(args[0])]
    } else if (methodName === 'unsafeLoadFromSync') {
      args = [args[0], nitroSyncSchema(args[1]), args[2], args[3]]
    } else if (methodName === 'provideSyncJson') {
      try {
        this._nitro.provideSyncJson(args[0] as number, args[1] as string)
        callback({ value: undefined as T })
      } catch (error) {
        this._unsafeErrorListener(error as Error)
        callback({ error: error as Error })
      }
      return
    }

    try {
      const method = (this._db as NativeDatabase)[methodName]
      if (!method) {
        throw new Error(
          `Cannot run database method ${methodName} because database failed to open. ${Object.keys(
            this._db,
          ).join(',')}`,
        )
      }
      // Nitro HybridObject methods read NativeState from `this`.
      let result = method.apply(this._db, args)
      if (result instanceof Error) {
        throw result
      } else {
        if (methodName === 'queryAsArray') {
          result = (
            require('./decodeQueryResult') as { default: (records: unknown[]) => unknown }
          ).default(result as unknown[])
        }
        callback({ value: result as T })
      }
    } catch (error) {
      this._unsafeErrorListener(error as Error)
      callback({ error: error as Error })
    }
  }
}

export const makeDispatcher = (
  type: DispatcherType,
  _tag: ConnectionTag,
  dbName: string,
  options: SqliteDispatcherOptions,
): SqliteDispatcher => {
  if (type === 'nitro' || type === 'jsi') {
    return new SqliteSyncDispatcher(dbName, options)
  }
  throw new Error(`SQLiteAdapter does not support dispatcher type ${type} on this platform`)
}

export function getDispatcherType(options: SQLiteAdapterOptions): DispatcherType {
  if (options.jsi === false) {
    throw new Error(
      'SQLiteAdapter NativeModules interop was removed. React Native uses Nitro only. Pass `{ jsi: false }` is no longer supported; use LokiJSAdapter on web or the Node/Electron SQLite adapter.',
    )
  }

  if (nitromelonOrNull()) {
    return 'nitro'
  }

  throw new Error(
    'SQLiteAdapter requires react-native-nitro-modules. Install the peer and rebuild the native app.',
  )
}
