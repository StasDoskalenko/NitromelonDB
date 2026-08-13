export default function allPromisesObj<Spec extends Record<string, Promise<unknown>>>(
  promisesObj: Spec,
): Promise<{ [K in keyof Spec]: Awaited<Spec[K]> }> {
  return new Promise((resolve, reject) => {
    const keys = Object.keys(promisesObj)
    const len = keys.length
    Promise.all(Object.values(promisesObj)).then((result) => {
      const resultObj: Record<string, unknown> = {}

      for (let i = 0; i < len; i++) {
        resultObj[keys[i]] = result[i]
      }

      resolve(resultObj as { [K in keyof Spec]: Awaited<Spec[K]> })
    }, reject)
  })
}
