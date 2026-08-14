/* eslint-disable global-require */

import { NativeModules, Platform } from 'react-native'
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

type JsiDatabase = {
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
    const nitroModule = require('../../../nitro') as { nitromelon: Nitromelon }
    if (typeof nitroModule.nitromelon.createAdapter !== 'function') {
      cachedNitromelon = null
      return null
    }
    cachedNitromelon = nitroModule.nitromelon
    return nitroModule.nitromelon
  } catch {
    cachedNitromelon = null
    return null
  }
}

function initializeWindowsJSI(): boolean {
  if (global.nativeWatermelonCreateAdapter) {
    return true
  }

  const bridge = NativeModules.WMDatabaseBridge as { initializeJSI?: () => void } | undefined
  if (bridge?.initializeJSI) {
    try {
      bridge.initializeJSI()
      return !!global.nativeWatermelonCreateAdapter
    } catch (e) {
      logger.error('[SQLite] Failed to initialize Windows JSI')
      logger.error(e)
    }
  }

  return false
}

class SqliteSyncDispatcher implements SqliteDispatcher {
  _db: NitromelonDatabase | JsiDatabase
  _nitro: Nitromelon | null
  _unsafeErrorListener: (error: Error) => void

  constructor(dbName: string, { usesExclusiveLocking }: SqliteDispatcherOptions) {
    this._unsafeErrorListener = () => {}
    const nitro = Platform.OS === 'windows' ? null : nitromelonOrNull()
    this._nitro = nitro
    if (nitro) {
      this._db = nitro.createAdapter(dbName, usesExclusiveLocking)
      return
    }

    const createAdapter = global.nativeWatermelonCreateAdapter
    invariant(
      createAdapter,
      'SQLiteAdapter could not create a native database. On Windows, ensure JSI is installed. On iOS/Android, install react-native-nitro-modules.',
    )
    this._db = createAdapter(dbName, usesExclusiveLocking)
  }

  call<T>(name: SqliteDispatcherMethod, _args: unknown[], callback: ResultCallback<T>): void {
    let methodName: string = name
    let args = _args

    if (methodName === 'query' && !global.HermesInternal) {
      methodName = 'queryAsArray'
    } else if (methodName === 'batch') {
      methodName = 'batchJSON'
      args = [JSON.stringify(args[0])]
    } else if (
      Platform.OS === 'windows' &&
      (methodName === 'provideSyncJson' || methodName === 'unsafeLoadFromSync')
    ) {
      callback({ error: new Error(`${methodName} unavailable on Windows. Please contribute.`) })
      return
    } else if (methodName === 'unsafeLoadFromSync' && this._nitro) {
      args = [args[0], nitroSyncSchema(args[1]), args[2], args[3]]
    } else if (methodName === 'provideSyncJson') {
      try {
        invariant(this._nitro, 'provideSyncJson requires Nitro')
        this._nitro.provideSyncJson(args[0] as number, args[1] as string)
        callback({ value: undefined as T })
      } catch (error) {
        this._unsafeErrorListener(error as Error)
        callback({ error: error as Error })
      }
      return
    }

    try {
      const method = (this._db as JsiDatabase)[methodName]
      if (!method) {
        throw new Error(
          `Cannot run database method ${methodName} because database failed to open. ${Object.keys(
            this._db,
          ).join(',')}`,
        )
      }
      let result = method(...args)
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
  if (options.jsi === false && Platform.OS !== 'windows') {
    throw new Error(
      'SQLiteAdapter NativeModules interop was removed. iOS/Android use Nitro only. Pass `{ jsi: false }` is no longer supported; use LokiJSAdapter on web or the Node/Electron SQLite adapter.',
    )
  }

  if (Platform.OS === 'windows') {
    if (!initializeWindowsJSI()) {
      throw new Error(
        'Windows SQLite requires the JSI installer. Rebuild the native app after installing WatermelonDB.',
      )
    }
    return 'jsi'
  }

  if (!nitromelonOrNull()) {
    throw new Error(
      'SQLiteAdapter requires react-native-nitro-modules on iOS and Android. Install the peer and rebuild the native app.',
    )
  }

  return 'nitro'
}
