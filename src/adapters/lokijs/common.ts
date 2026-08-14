import type { Result } from '../../utils/fp/Result'
import type { CachedQueryResult, CachedFindResult } from '../type'
import type { RecordId } from '../../Model'

export type WorkerExecutorType =
  | 'setUp'
  | 'find'
  | 'query'
  | 'queryIds'
  | 'unsafeQueryRaw'
  | 'count'
  | 'batch'
  | 'getDeletedRecords'
  | 'unsafeResetDatabase'
  | 'unsafeExecute'
  | 'getLocal'
  | 'setLocal'
  | 'removeLocal'
  | '_fatalError'
  | 'clearCachedRecords'

export type WorkerExecutorPayload = unknown[]

export type WorkerResponseData =
  | CachedQueryResult
  | CachedFindResult
  | number
  | RecordId[]
  | string
  | unknown[]
  | null
  | undefined
  | void

export type CloneMethod = 'shallowCloneDeepObjects' | 'immutable' | 'deep'

export type WorkerAction = {
  id: number
  type: WorkerExecutorType
  payload: WorkerExecutorPayload
  cloneMethod: CloneMethod
  returnCloneMethod: CloneMethod
}

export type WorkerResponse = {
  id: number
  result: Result<WorkerResponseData>
  cloneMethod?: CloneMethod | undefined
}
