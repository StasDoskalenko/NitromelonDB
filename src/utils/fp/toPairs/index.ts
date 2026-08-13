// inspired by ramda and rambda
/* eslint-disable */
export default function toPairs<O = any>(obj?: { [key: string]: O } | null): [string, O][] {
  var pairs: [string, O][] = []

  if (obj) {
    var keys = Object.keys(obj)

    for (var i = 0, len = keys.length; i < len; i++) {
      var prop = keys[i]
      var value = obj[prop]

      if (prop in obj) {
        pairs[i] = [prop, value]
      }
    }
  }

  return pairs
}
