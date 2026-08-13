// inspired by ramda and rambda
/* eslint-disable */
export default function fromPairs<O = any>(pairs: [string, O][]): { [key: string]: O } {
  const result: { [key: string]: O } = {}

  for (var i = 0, l = pairs.length; i < l; i++) {
    result[pairs[i][0]] = pairs[i][1]
  }

  return result
}
