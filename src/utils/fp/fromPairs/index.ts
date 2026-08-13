// inspired by ramda and rambda
export default function fromPairs<O>(pairs: [string, O][]): { [key: string]: O } {
  const result: { [key: string]: O } = {}

  for (let i = 0, l = pairs.length; i < l; i++) {
    result[pairs[i][0]] = pairs[i][1]
  }

  return result
}
