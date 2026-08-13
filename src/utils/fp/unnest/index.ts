// inspired by ramda and rambda
/* eslint-disable */
export default function unnest<T>(arr: Array<T | T[]>): T[] {
  var result: T[] = []

  for (var i = 0, l = arr.length; i < l; i++) {
    var value = arr[i]

    if (Array.isArray(value)) {
      result = result.concat(value)
    } else {
      result.push(value)
    }
  }

  return result
}
