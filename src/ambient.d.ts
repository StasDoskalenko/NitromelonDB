declare const global: typeof globalThis & {
  nativePerformanceNow?: () => number
  nativeWatermelonCreateAdapter?: (
    dbName: string,
    usesExclusiveLocking: boolean,
  ) => {
    [methodName: string]: ((...args: unknown[]) => unknown) | undefined
  }
  HermesInternal?: object | null
}

declare function require(name: string): unknown

declare const process: {
  env: {
    NODE_ENV?: string
    [key: string]: string | undefined
  }
  nextTick?: (callback: () => void) => void
  cwd: () => string
}

declare module 'sql-escape-string' {
  function escapeString(value: string): string
  export default escapeString
}
