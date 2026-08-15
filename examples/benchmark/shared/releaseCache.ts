/**
 * Drop JS identity maps after a batch so 1M models do not stay on the heap.
 *
 * Native SQLite still keeps those IDs in its "already cached" set, so `fetch()` /
 * `find()` will fail afterward. Benchmark queries must use `fetchCount`,
 * `fetchIds`, or `unsafeFetchRaw` until this collection is reset.
 */
export function releaseCollectionCache(collection: {
  _cache: { unsafeClear: () => void }
  database?: { adapter?: { underlyingAdapter?: { _clearCachedRecords?: () => void } } }
}): void {
  collection._cache.unsafeClear()
  collection.database?.adapter?.underlyingAdapter?._clearCachedRecords?.()
}
