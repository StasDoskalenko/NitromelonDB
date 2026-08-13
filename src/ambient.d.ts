declare const global: typeof globalThis & {
  nativePerformanceNow?: () => number
}

declare function require(name: string): unknown

declare const process: {
  env: {
    NODE_ENV?: string
    [key: string]: string | undefined
  }
}
