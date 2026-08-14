/* eslint-disable getter-return */

// Used as a placeholder during reset database to catch illegal
// adapter calls

const throwError = (name: string): never => {
  throw new Error(`Cannot call database.adapter.${name} while the database is being reset`)
}

export default class ErrorAdapter {
  find = (): never => throwError('find')
  query = (): never => throwError('query')
  queryIds = (): never => throwError('queryIds')
  count = (): never => throwError('count')
  batch = (): never => throwError('batch')
  getDeletedRecords = (): never => throwError('getDeletedRecords')
  destroyDeletedRecords = (): never => throwError('destroyDeletedRecords')
  unsafeResetDatabase = (): never => throwError('unsafeResetDatabase')
  getLocal = (): never => throwError('getLocal')
  setLocal = (): never => throwError('setLocal')
  removeLocal = (): never => throwError('removeLocal')
  testClone = (): never => throwError('testClone')

  get underlyingAdapter(): never {
    return throwError('underlyingAdapter')
  }

  get schema(): never {
    return throwError('schema')
  }

  get migrations(): never {
    return throwError('migrations')
  }
}
