// lightweight type-only Result (Success(T) | Error) monad
export type Result<T> = { value: T; error?: undefined } | { error: Error; value?: undefined }

export type ResultCallback<T> = (result: Result<T>) => void

export function toPromise<T>(withCallback: (callback: ResultCallback<T>) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    withCallback((result) => {
      if (result.error) {
        reject(result.error)
        return
      }

      resolve(result.value)
    })
  })
}

export function fromPromise<T>(promise: Promise<T>, callback: ResultCallback<T>): void {
  promise.then(
    (value) => callback({ value }),
    (error) => callback({ error }),
  )
}

export function mapValue<T, U>(mapper: (value: T) => U, result: Result<T>): Result<U> {
  if (result.error) {
    return { error: result.error }
  }

  try {
    return { value: mapper(result.value) }
  } catch (error) {
    return { error: error as Error }
  }
}
