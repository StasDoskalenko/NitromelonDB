// inspired by ramda and rambda
export default function toPairs<O>(obj?: { [key: string]: O } | null): [string, O][] {
  const pairs: [string, O][] = []

  if (obj) {
    const keys = Object.keys(obj)

    for (let i = 0, len = keys.length; i < len; i++) {
      const prop = keys[i]
      const value = obj[prop]

      if (prop in obj) {
        pairs[i] = [prop, value]
      }
    }
  }

  return pairs
}
