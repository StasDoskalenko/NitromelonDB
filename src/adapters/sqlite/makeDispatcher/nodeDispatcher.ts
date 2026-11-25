/* eslint-disable global-require */

import DatabaseBridge from '../sqlite-node/DatabaseBridge'
import { getPath } from '../sqlite-node/DatabaseDriver'
import { nodeEncryption } from '../sqlite-node/Database'
import { NODE_SWITCH_HINT, probeFile } from '../sqlite-node/encryption'
import type { ConnectionTag } from '../../../utils/common'
import type { ResultCallback } from '../../../utils/fp/Result'
import type {
  DatabaseEncryptionState,
  DispatcherType,
  SQLiteAdapterOptions,
  SqliteDispatcher,
  SqliteDispatcherMethod,
  SqliteDispatcherOptions,
} from '../type'

class SqliteNodeDispatcher implements SqliteDispatcher {
  _tag: ConnectionTag

  constructor(tag: ConnectionTag) {
    this._tag = tag
  }

  call<T>(methodName: SqliteDispatcherMethod, args: unknown[], callback: ResultCallback<T>): void {
    const bridge = DatabaseBridge as unknown as Record<
      string,
      (tag: ConnectionTag, ...methodArgs: unknown[]) => void
    >
    const method = bridge[methodName].bind(DatabaseBridge)
    method(
      this._tag,
      ...args,
      (value: T) => callback({ value }),
      (_code: string, _message: string, error: Error) => callback({ error }),
    )
  }
}

export const makeDispatcher = (
  _type: DispatcherType,
  tag: ConnectionTag,
  _dbName: string,
  options: SqliteDispatcherOptions,
): SqliteDispatcher => {
  DatabaseBridge.setStoreWholeNumbersAsIntegers(tag, options.storeWholeNumbersAsIntegers)
  DatabaseBridge.setEncryption(
    tag,
    options.passphrase
      ? { passphrase: options.passphrase, allowUnencrypted: !!options.allowUnencrypted }
      : null,
  )
  return new SqliteNodeDispatcher(tag)
}

export function getDispatcherType(_options: SQLiteAdapterOptions): DispatcherType {
  return 'asynchronous'
}

// With better-sqlite3-multiple-ciphers installed (sqlite-node/encryption.ts)
export function isEncryptionAvailable(): boolean {
  return nodeEncryption().hasCodec
}

// Why encryption isn't available, for the error SQLiteAdapter throws
export function encryptionUnavailableHint(): string {
  return NODE_SWITCH_HINT
}

export function getDatabaseEncryptionState(dbName: string): DatabaseEncryptionState {
  return probeFile(getPath(dbName))
}
