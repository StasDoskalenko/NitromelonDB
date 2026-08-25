// A key -> value cache that lets values become garbage-collected once
// nothing else references them, instead of pinning every value ever cached
// for the process's lifetime.
//
// Keys here are typically primitives (record ids, cache keys, timestamps),
// so a literal WeakMap doesn't apply (its keys must be objects) -- this is
// `Map<K, WeakRef<V>>` plus a FinalizationRegistry that prunes a dead
// entry's map slot once its value is collected.
//
// Runtime support is tiered, since this library isn't RN-only (see the
// LokiJS adapter, used outside RN/Hermes):
// - WeakRef + FinalizationRegistry both available (Hermes/RN new-arch, every
//   evergreen browser/Node/Electron target): full support, entries are
//   pruned promptly after their value is collected.
// - WeakRef available, FinalizationRegistry missing: same weak reads, but
//   pruning is backed by our own lazily-started polling sweep instead.
// - Neither available: falls back to holding a plain strong reference, i.e.
//   today's unbounded-but-correct behavior. A real weak reference can't be
//   polyfilled without engine support, so this tier doesn't pretend to be
//   weak -- it just doesn't regress.

const hasWeakRef = typeof WeakRef !== 'undefined'
const hasFinalizationRegistry = typeof FinalizationRegistry !== 'undefined'

const SWEEP_INTERVAL_MS = 30000

type WeakRefLike<V> = { deref(): V | undefined }

export default class WeakValueCache<K, V extends object> {
  _map: Map<K, WeakRefLike<V>> = new Map()

  _registry: FinalizationRegistry<K> | undefined

  _sweepTimer: ReturnType<typeof setInterval> | undefined

  constructor() {
    if (hasWeakRef && hasFinalizationRegistry) {
      this._registry = new FinalizationRegistry(this._finalize)
    }
  }

  // Exposed as a named, arrow-bound method (rather than inlined in the
  // constructor) purely so it's directly testable in isolation, without
  // depending on real GC/FinalizationRegistry timing.
  _finalize = (key: K): void => {
    // Re-check the current slot before deleting: a newer, live value may
    // already have been set() under this key before this finalizer ran for
    // the old one -- don't evict the live one.
    const ref = this._map.get(key)
    if (ref && ref.deref() === undefined) {
      this._map.delete(key)
    }
  }

  get(key: K): V | undefined {
    const ref = this._map.get(key)
    if (!ref) {
      return undefined
    }
    const value = ref.deref()
    if (value === undefined) {
      this._map.delete(key)
    }
    return value
  }

  set(key: K, value: V): void {
    if (hasWeakRef) {
      this._map.set(key, new WeakRef(value))
      if (this._registry) {
        this._registry.register(value, key, value)
      } else {
        this._startSweeping()
      }
    } else {
      // Tier 3: no WeakRef available -- plain strong reference, see file comment
      this._map.set(key, { deref: () => value })
    }
  }

  delete(key: K): void {
    const ref = this._map.get(key)
    this._map.delete(key)
    if (this._registry && ref) {
      const value = ref.deref()
      value !== undefined && this._registry.unregister(value)
    }
  }

  clear(): void {
    this._map = new Map()
    // Stale finalizer callbacks from the old generation will find nothing in
    // the swapped-out map and no-op -- safe by construction.
  }

  get size(): number {
    return this._map.size
  }

  forEach(callback: (value: V, key: K) => void): void {
    this._map.forEach((ref, key) => {
      const value = ref.deref()
      if (value === undefined) {
        this._map.delete(key)
      } else {
        callback(value, key)
      }
    })
  }

  // Tier 2 only (WeakRef without FinalizationRegistry): a best-effort
  // backstop, not a correctness requirement -- get()/delete() always
  // self-check via a real deref() regardless of sweep timing, this just
  // reclaims dead map slots that nothing has looked up lately.
  _startSweeping(): void {
    if (this._sweepTimer) {
      return
    }
    this._sweepTimer = setInterval(() => {
      this._map.forEach((ref, key) => {
        if (ref.deref() === undefined) {
          this._map.delete(key)
        }
      })
    }, SWEEP_INTERVAL_MS)
    // Node/Hermes timers support unref() so a lingering interval doesn't
    // keep a process alive; browser timers don't have (or need) it.
    ;(this._sweepTimer as unknown as { unref?: () => void }).unref?.()
  }
}
