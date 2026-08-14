import type { ResultCallback } from '../../utils/fp/Result'
import type {
  WorkerExecutorType,
  WorkerResponse,
  WorkerExecutorPayload,
  WorkerResponseData,
  CloneMethod,
} from './common'

type PendingWorkerCall = {
  id: number
  callback: ResultCallback<WorkerResponseData>
}

type LokiDispatchWorker = {
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage: (message: unknown) => void
}

type LokiWorkerConstructor = new () => LokiDispatchWorker

function createWorker(useWebWorker: boolean): LokiDispatchWorker {
  if (useWebWorker) {
    const LokiWebWorker = require('./worker/loki.worker') as LokiWorkerConstructor
    return new LokiWebWorker()
  }

  const LokiSynchronousWorker = (
    require('./worker/synchronousWorker') as { default: LokiWorkerConstructor }
  ).default
  return new LokiSynchronousWorker()
}

let _actionId = 0

function nextActionId(): number {
  _actionId += 1
  return _actionId
}

export default class LokiDispatcher {
  _worker: LokiDispatchWorker

  _pendingCalls: PendingWorkerCall[] = []

  constructor(useWebWorker: boolean) {
    this._worker = createWorker(useWebWorker)
    this._worker.onmessage = ({ data }) => {
      const { result, id: responseId } = data as WorkerResponse
      const { callback, id } = this._pendingCalls.shift() as PendingWorkerCall

      // sanity check
      if (id !== responseId) {
        callback({ error: new Error('Loki worker responses are out of order') })
        return
      }

      callback(result)
    }
  }

  call<T>(
    type: WorkerExecutorType,
    payload: WorkerExecutorPayload = [],
    callback: ResultCallback<T> = () => {},
    // NOTE: This are used when not using web workers (otherwise, the data naturally is just copied)
    cloneMethod: CloneMethod = 'immutable',
    returnCloneMethod: CloneMethod = 'immutable',
  ): void {
    const id = nextActionId()
    this._pendingCalls.push({
      callback: callback as ResultCallback<WorkerResponseData>,
      id,
    })
    this._worker.postMessage({ id, type, payload, cloneMethod, returnCloneMethod })
  }
}
