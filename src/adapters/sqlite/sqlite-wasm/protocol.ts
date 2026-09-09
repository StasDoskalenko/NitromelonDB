import type { ConnectionTag } from '../../../utils/common'
import type { SqliteDispatcherMethod } from '../type'

export type WorkerRequest = {
  id: number
  tag: ConnectionTag
  method: SqliteDispatcherMethod
  args: unknown[]
  wasmUrl?: string | undefined
}

export type SerializedWorkerError = {
  name: string
  message: string
  stack?: string | undefined
  code?: string | number | undefined
}

export type WorkerResponse =
  | { id: number; value: unknown }
  | { id: number; error: SerializedWorkerError }

export function serializeError(error: unknown): SerializedWorkerError {
  const value = error instanceof Error ? error : new Error(String(error))
  const code = (value as Error & { code?: string | number }).code
  return {
    name: value.name,
    message: value.message,
    ...(value.stack ? { stack: value.stack } : {}),
    ...(code !== undefined ? { code } : {}),
  }
}

export function deserializeError(value: SerializedWorkerError): Error {
  const error = new Error(value.message)
  error.name = value.name
  if (value.stack) {
    error.stack = value.stack
  }
  if (value.code !== undefined) {
    ;(error as Error & { code?: string | number }).code = value.code
  }
  return error
}
