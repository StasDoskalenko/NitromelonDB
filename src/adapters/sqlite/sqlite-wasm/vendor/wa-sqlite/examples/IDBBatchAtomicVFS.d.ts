// NitromelonDB's minimal typing for the vendored, unmodified wa-sqlite
// `examples/IDBBatchAtomicVFS.js` (not part of the upstream snapshot).
export class IDBBatchAtomicVFS {
  name: string
  static create(
    name: string,
    module: object,
    options?: { idbName?: string },
  ): Promise<IDBBatchAtomicVFS>
  close(): void
}
