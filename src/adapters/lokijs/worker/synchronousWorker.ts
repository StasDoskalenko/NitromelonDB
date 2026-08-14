import DatabaseBridge, { type LokiWorkerContext } from './DatabaseBridge'
import cloneMessage from './cloneMessage'

type WorkerMessageEvent = { data: unknown }

// Simulates the web worker API
export default class SynchronousWorker {
  _bridge: DatabaseBridge

  _workerContext: LokiWorkerContext

  onmessage: (event: WorkerMessageEvent) => void = () => {}

  constructor() {
    this._workerContext = {
      postMessage: (data) => {
        this.onmessage({ data: cloneMessage(data) })
      },
      onmessage: () => {},
    }
    this._bridge = new DatabaseBridge(this._workerContext)
  }

  postMessage(data: unknown): void {
    const onmessage = this._workerContext.onmessage
    if (onmessage) {
      onmessage({ data: cloneMessage(data) })
    }
  }
}
