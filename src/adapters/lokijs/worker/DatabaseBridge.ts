// don't import whole `utils` to keep worker size small
import type { Result } from '../../../utils/fp/Result'
import logError from '../../../utils/common/logError'
import invariant from '../../../utils/common/invariant'

import DatabaseDriver from './DatabaseDriver'
import type { WorkerAction, WorkerExecutorType, WorkerResponseData } from '../common'
import type { LokiAdapterOptions } from '../type'

export type LokiWorkerContext = {
  postMessage: (message: unknown) => void
  onmessage: ((event: { data: unknown }) => void) | null
}

type DriverActionFn = (...args: unknown[]) => unknown

export default class DatabaseBridge {
  workerContext: LokiWorkerContext

  driver: DatabaseDriver | null | undefined

  queue: WorkerAction[] = []

  _actionsExecuting: number = 0

  constructor(workerContext: LokiWorkerContext) {
    this.workerContext = workerContext
    this.workerContext.onmessage = (e: { data: unknown }) => {
      const action = e.data as WorkerAction
      // enqueue action
      this.queue.push(action)

      if (this.queue.length === 1) {
        this.executeNext()
      }
    }
  }

  executeNext(): void {
    const action = this.queue[0]
    try {
      invariant(this._actionsExecuting === 0, 'worker should not have ongoing actions') // sanity check
      this._actionsExecuting += 1

      const { type, payload } = action

      if (type === 'setUp' || type === 'unsafeResetDatabase') {
        this.processActionAsync(action)
      } else {
        const response = this._driverAction(type)(...payload)
        this.onActionDone(action, { value: response as WorkerResponseData })
      }
    } catch (error) {
      this._onError(action, error)
    }
  }

  async processActionAsync(action: WorkerAction): Promise<void> {
    try {
      const { type, payload } = action

      if (type === 'setUp') {
        // app just launched, set up driver with options sent
        invariant(!this.driver, `Loki driver already set up - cannot set up again`)
        const [options] = payload
        const driver = new DatabaseDriver(options as LokiAdapterOptions)

        // set up, make this.driver available only if successful
        await driver.setUp()
        this.driver = driver

        this.onActionDone(action, { value: null })
      } else {
        const response = await this._driverAction(type)(...payload)
        this.onActionDone(action, { value: response as WorkerResponseData })
      }
    } catch (error) {
      this._onError(action, error)
    }
  }

  onActionDone(action: WorkerAction, result: Result<WorkerResponseData>): void {
    invariant(this._actionsExecuting === 1, 'worker should be executing 1 action') // sanity check
    this._actionsExecuting = 0
    this.queue.shift()

    try {
      const response = { id: action.id, result, cloneMethod: action.returnCloneMethod }
      this.workerContext.postMessage(response)
    } catch (error) {
      logError(String(error))
    }

    if (this.queue.length) {
      this.executeNext()
    }
  }

  _driverAction(_type: WorkerExecutorType): DriverActionFn {
    invariant(this.driver, `Cannot run actions because driver is not set up`)
    const type = _type as keyof DatabaseDriver
    const action = this.driver[type]
    invariant(typeof action === 'function', `Unknown worker action ${_type}`)
    const fn = action as (this: DatabaseDriver, ...args: unknown[]) => unknown
    return (...args: unknown[]) => fn.apply(this.driver as DatabaseDriver, args)
  }

  _onError(action: WorkerAction, error: unknown): void {
    // Main process only receives error message (when using web workers) — this logError is to retain call stack
    logError(String(error))
    const resultError = error instanceof Error ? error : new Error(String(error))
    this.onActionDone(action, { error: resultError })
  }
}
