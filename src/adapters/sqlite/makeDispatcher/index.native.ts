/* eslint-disable global-require */

import { NativeModules, Platform } from 'react-native'
import { type ConnectionTag, logger, invariant } from '../../../utils/common'
import { fromPromise, type ResultCallback } from '../../../utils/fp/Result'
import type {
  DispatcherType,
  SQLiteAdapterOptions,
  SqliteDispatcher,
  SqliteDispatcherMethod,
  SqliteDispatcherOptions,
} from '../type'

type NativeDatabaseBridge = {
  batchJSON?: (tag: ConnectionTag, json: string) => Promise<unknown>
  initializeJSI?: () => void
  provideSyncJson?: (...args: unknown[]) => Promise<unknown>
  [key: string]: unknown
}

type JsiDatabase = {
  [methodName: string]: ((...args: unknown[]) => unknown) | undefined
}

const WMDatabaseBridge = NativeModules.WMDatabaseBridge as NativeDatabaseBridge | undefined
const WMDatabaseJSIBridge = NativeModules.WMDatabaseJSIBridge as { install?: () => void } | undefined

class SqliteNativeModulesDispatcher implements SqliteDispatcher {
  _tag: ConnectionTag
  _unsafeNativeReuse: boolean
  _bridge: NativeDatabaseBridge

  constructor(
    tag: ConnectionTag,
    bridge: NativeDatabaseBridge | undefined,
    { experimentalUnsafeNativeReuse }: SqliteDispatcherOptions,
  ) {
    this._tag = tag
    this._bridge = bridge as NativeDatabaseBridge
    this._unsafeNativeReuse = experimentalUnsafeNativeReuse
    if (process.env.NODE_ENV !== 'production') {
      invariant(
        this._bridge,
        `NativeModules.WMDatabaseBridge is not defined! This means that you haven't properly linked WatermelonDB native module. Refer to docs for instructions about installation (and the changelog if this happened after an upgrade).`,
      )

      invariant(
        Platform.OS !== 'windows',
        'Windows is only supported via JSI. Pass { jsi: true } to SQLiteAdapter constructor.',
      )
    }
  }

  call<T>(name: SqliteDispatcherMethod, _args: unknown[], callback: ResultCallback<T>): void {
    let methodName: string = name
    let args = _args
    if (methodName === 'batch' && this._bridge.batchJSON) {
      methodName = 'batchJSON'
      args = [JSON.stringify(args[0])]
    } else if (
      ['initialize', 'setUpWithSchema', 'setUpWithMigrations'].includes(methodName) &&
      Platform.OS === 'android'
    ) {
      // FIXME: Hacky, refactor once native reuse isn't an "unsafe experimental" option
      args.push(this._unsafeNativeReuse)
    }
    const method = this._bridge[methodName] as (...methodArgs: unknown[]) => Promise<T>
    fromPromise(method(this._tag, ...args), callback)
  }
}

class SqliteJsiDispatcher implements SqliteDispatcher {
  _db: JsiDatabase
  _unsafeErrorListener: (error: Error) => void // debug hook for NT use

  constructor(dbName: string, { usesExclusiveLocking }: SqliteDispatcherOptions) {
    const createAdapter = global.nativeWatermelonCreateAdapter as (
      name: string,
      exclusiveLocking: boolean,
    ) => JsiDatabase
    this._db = createAdapter(dbName, usesExclusiveLocking)
    this._unsafeErrorListener = () => {}
  }

  call<T>(name: SqliteDispatcherMethod, _args: unknown[], callback: ResultCallback<T>): void {
    let methodName: string = name
    let args = _args

    if (methodName === 'query' && !global.HermesInternal) {
      // NOTE: compressing results of a query into a compact array makes querying 15-30% faster on JSC
      // but actually 9% slower on Hermes (presumably because Hermes has faster C++ JSI and slower JS execution)
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
    } else if (methodName === 'provideSyncJson') {
      fromPromise(WMDatabaseBridge?.provideSyncJson?.(...args) as Promise<T>, callback)
      return
    }

    try {
      const method = this._db[methodName]
      if (!method) {
        throw new Error(
          `Cannot run database method ${methodName} because database failed to open. Hint: Did you install JSI correctly? This happens if you forgot to configure Proguard correctly ${Object.keys(
            this._db,
          ).join(',')}`,
        )
      }
      let result = method(...args)
      // On Android, errors are returned, not thrown - see DatabaseBridge.cpp
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
  tag: ConnectionTag,
  dbName: string,
  options: SqliteDispatcherOptions,
): SqliteDispatcher => {
  switch (type) {
    case 'jsi':
      return new SqliteJsiDispatcher(dbName, options)
    case 'asynchronous':
      return new SqliteNativeModulesDispatcher(tag, WMDatabaseBridge, options)
    default:
      throw new Error('Unknown DispatcherType')
  }
}

const initializeJSI = (): boolean => {
  if (global.nativeWatermelonCreateAdapter) {
    return true
  }

  const bridge = WMDatabaseBridge
  if (bridge?.initializeJSI) {
    try {
      bridge.initializeJSI()
      return !!global.nativeWatermelonCreateAdapter
    } catch (e) {
      logger.error('[SQLite] Failed to initialize JSI')
      logger.error(e)
    }
  } else if (WMDatabaseJSIBridge && WMDatabaseJSIBridge.install) {
    WMDatabaseJSIBridge.install()
    return !!global.nativeWatermelonCreateAdapter
  }

  return false
}

export function getDispatcherType(options: SQLiteAdapterOptions): DispatcherType {
  if (options.jsi) {
    if (initializeJSI()) {
      return 'jsi'
    }

    logger.warn(
      `JSI SQLiteAdapter not available… falling back to asynchronous operation. This will happen if you're using remote debugger, and may happen if you forgot to recompile native app after WatermelonDB update`,
    )
  }

  return 'asynchronous'
}
