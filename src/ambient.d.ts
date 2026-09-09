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

declare module '*.wasm' {
  const asset: string | number | { uri: string }
  export default asset
}

declare module '*.mjs' {
  const factory: (options?: Record<string, unknown>) => Promise<object>
  export default factory
}

declare module 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js' {
  export class IDBBatchAtomicVFS {
    name: string
    static create(
      name: string,
      module: object,
      options?: { idbName?: string },
    ): Promise<IDBBatchAtomicVFS>
    close(): void
  }
}
