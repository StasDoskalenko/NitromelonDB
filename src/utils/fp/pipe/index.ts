type Pipe = (<A, B, C, D, E, F, G>(
  ab: (arg0: A) => B,
  bc: (arg0: B) => C,
  cd: (arg0: C) => D,
  de: (arg0: D) => E,
  ef: (arg0: E) => F,
  fg: (arg0: F) => G,
) => (arg0: A) => G) &
  (<A, B, C, D, E, F>(
    ab: (arg0: A) => B,
    bc: (arg0: B) => C,
    cd: (arg0: C) => D,
    de: (arg0: D) => E,
    ef: (arg0: E) => F,
  ) => (arg0: A) => F) &
  (<A, B, C, D, E>(
    ab: (arg0: A) => B,
    bc: (arg0: B) => C,
    cd: (arg0: C) => D,
    de: (arg0: D) => E,
  ) => (arg0: A) => E) &
  (<A, B, C, D>(ab: (arg0: A) => B, bc: (arg0: B) => C, cd: (arg0: C) => D) => (arg0: A) => D) &
  (<A, B, C>(ab: (arg0: A) => B, bc: (arg0: B) => C) => (arg0: A) => C) &
  (<A, B>(ab: (arg0: A) => B) => (arg0: A) => B)

function pipe(...fns: Array<(...args: unknown[]) => unknown>): (...args: unknown[]) => unknown {
  const fnsLen = fns.length
  return (...args: unknown[]) => {
    let result: unknown

    if (fnsLen) {
      result = fns[0](...args)

      for (let i = 1; i < fnsLen; i++) {
        result = fns[i](result)
      }
    }

    return result
  }
}

export default pipe as Pipe
