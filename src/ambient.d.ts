declare const global: typeof globalThis & {
  nativePerformanceNow?: () => number
}

declare function require(name: string): any

declare const process: {
  env: {
    NODE_ENV?: string
    [key: string]: string | undefined
  }
}
