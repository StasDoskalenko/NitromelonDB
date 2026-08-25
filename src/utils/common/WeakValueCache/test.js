import WeakValueCache from './index'

describe('WeakValueCache', () => {
  it('returns a cached value while it is still referenced', () => {
    const cache = new WeakValueCache()
    const value = { name: 'a' }
    cache.set('k', value)

    expect(cache.get('k')).toBe(value)
    expect(cache.size).toBe(1)
  })

  it('returns undefined for a key that was never set', () => {
    const cache = new WeakValueCache()
    expect(cache.get('missing')).toBe(undefined)
  })

  it('delete() removes an entry', () => {
    const cache = new WeakValueCache()
    cache.set('k', {})
    cache.delete('k')

    expect(cache.get('k')).toBe(undefined)
    expect(cache.size).toBe(0)
  })

  it('clear() drops all entries', () => {
    const cache = new WeakValueCache()
    cache.set('a', {})
    cache.set('b', {})
    cache.clear()

    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBe(undefined)
  })

  it('treats a dead WeakRef as a cache miss and prunes its slot', () => {
    // Simulates the referent having been garbage-collected, without waiting
    // on a real (unpredictably-timed) GC cycle.
    const cache = new WeakValueCache()
    cache.set('k', {})

    const ref = cache._map.get('k')
    ref.deref = () => undefined

    expect(cache.get('k')).toBe(undefined)
    expect(cache._map.has('k')).toBe(false)
    expect(cache.size).toBe(0)
  })

  it("_finalize() doesn't evict a live value that replaced a dead one under the same key", () => {
    // Covers the add()-before-finalize race: a FinalizationRegistry callback
    // for an old value can fire after a new, live value has already been
    // set() under the same key -- it must not evict the new one.
    const cache = new WeakValueCache()
    cache.set('k', {})
    cache.set('k', { name: 'live' })

    cache._finalize('k')

    expect(cache.get('k')).toEqual({ name: 'live' })
  })

  it('_finalize() evicts a slot whose value is actually dead', () => {
    const cache = new WeakValueCache()
    cache.set('k', {})

    const ref = cache._map.get('k')
    ref.deref = () => undefined

    cache._finalize('k')

    expect(cache._map.has('k')).toBe(false)
  })

  it('forEach() visits only live entries and prunes dead ones', () => {
    const cache = new WeakValueCache()
    cache.set('a', { name: 'a' })
    cache.set('b', { name: 'b' })

    const ref = cache._map.get('b')
    ref.deref = () => undefined

    const seen = []
    cache.forEach((value, key) => seen.push([key, value]))

    expect(seen).toEqual([['a', { name: 'a' }]])
    expect(cache._map.has('b')).toBe(false)
  })

  it('_finalize() is a no-op for a key that was already cleared', () => {
    const cache = new WeakValueCache()
    cache.set('k', {})
    cache.clear()

    expect(() => cache._finalize('k')).not.toThrow()
    expect(cache.size).toBe(0)
  })
})

describe('WeakValueCache (no WeakRef/FinalizationRegistry support)', () => {
  it('falls back to holding a plain strong reference', () => {
    const originalWeakRef = global.WeakRef
    const originalFinalizationRegistry = global.FinalizationRegistry
    delete global.WeakRef
    delete global.FinalizationRegistry

    let FallbackWeakValueCache
    try {
      jest.isolateModules(() => {
        FallbackWeakValueCache = require('./index').default
      })
    } finally {
      global.WeakRef = originalWeakRef
      global.FinalizationRegistry = originalFinalizationRegistry
    }

    const cache = new FallbackWeakValueCache()
    const value = {}
    cache.set('k', value)

    expect(cache.get('k')).toBe(value)
    expect(cache.size).toBe(1)

    cache.delete('k')
    expect(cache.get('k')).toBe(undefined)
    expect(cache.size).toBe(0)
  })
})
