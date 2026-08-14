/* eslint-disable no-restricted-globals */

import DatabaseBridge, { type LokiWorkerContext } from './DatabaseBridge'

type LokiWorkerScope = LokiWorkerContext & {
  workerClass?: DatabaseBridge | undefined
}

const getDefaultExport = (): LokiWorkerScope => {
  const scope = self as unknown as LokiWorkerScope
  scope.workerClass = new DatabaseBridge(scope)
  return scope
}

export default getDefaultExport()
