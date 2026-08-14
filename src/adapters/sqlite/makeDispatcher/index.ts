/* eslint-disable global-require */

import DatabaseBridge from '../sqlite-node/DatabaseBridge'
import type { ConnectionTag } from '../../../utils/common'
import type { ResultCallback } from '../../../utils/fp/Result'
import type {
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
  _options: SqliteDispatcherOptions,
): SqliteDispatcher => {
  return new SqliteNodeDispatcher(tag)
}

export function getDispatcherType(_options: SQLiteAdapterOptions): DispatcherType {
  return 'asynchronous'
}
