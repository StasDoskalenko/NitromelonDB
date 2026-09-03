import KeyedSharedSubscribable from './index'

describe('KeyedSharedSubscribable', () => {
  it('creates one source per distinct key', () => {
    const emitters = {}
    const sourceFor = jest.fn((key) => (subscriber) => {
      emitters[key] = subscriber
      return () => {}
    })
    const keyed = new KeyedSharedSubscribable(String, sourceFor)

    keyed.subscribe('a', () => {})
    keyed.subscribe('b', () => {})

    expect(sourceFor).toHaveBeenCalledTimes(2)
    expect(sourceFor).toHaveBeenCalledWith('a')
    expect(sourceFor).toHaveBeenCalledWith('b')
    expect(Object.keys(emitters)).toEqual(['a', 'b'])
  })

  it('shares one source across multiple subscribers with the same key (no re-subscribing the source)', () => {
    const sourceUnsubscribe = jest.fn()
    let emit = null
    const sourceFor = jest.fn(() => (subscriber) => {
      emit = subscriber
      return sourceUnsubscribe
    })
    const keyed = new KeyedSharedSubscribable(String, sourceFor)

    const subscriber1 = jest.fn()
    const subscriber2 = jest.fn()
    const unsubscribe1 = keyed.subscribe('q', subscriber1)
    const unsubscribe2 = keyed.subscribe('q', subscriber2)

    // The expensive part (sourceFor / the source function it returns) only
    // ran once, even though there are two subscribers.
    expect(sourceFor).toHaveBeenCalledTimes(1)

    emit('value')
    expect(subscriber1).toHaveBeenLastCalledWith('value')
    expect(subscriber2).toHaveBeenLastCalledWith('value')

    unsubscribe1()
    expect(sourceUnsubscribe).not.toHaveBeenCalled()
    unsubscribe2()
    expect(sourceUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it('lets different keys resolve to the same cache key, sharing a source', () => {
    const sourceFor = jest.fn(() => () => () => {})
    // Two semantically-equivalent-but-differently-shaped keys (e.g. column
    // lists in different orders) can share a source by normalizing them to
    // the same string in `keyOf`.
    const keyed = new KeyedSharedSubscribable(
      (columns) => columns.slice().sort().join(','),
      sourceFor,
    )

    keyed.subscribe(['a', 'b'], () => {})
    keyed.subscribe(['b', 'a'], () => {})

    expect(sourceFor).toHaveBeenCalledTimes(1)
  })

  it('calls sourceFor again once a key becomes active after being fully idle', () => {
    // The family evicts a key's SharedSubscribable once its last subscriber
    // leaves (so it doesn't keep every key ever observed cached forever) --
    // resubscribing to a previously-idle key therefore rebuilds it from
    // scratch, including a fresh call to sourceFor, not just to the source
    // function it previously returned.
    const source = jest.fn(() => () => {})
    const sourceFor = jest.fn(() => source)
    const keyed = new KeyedSharedSubscribable(String, sourceFor)

    const unsubscribe1 = keyed.subscribe('q', () => {})
    unsubscribe1()
    expect(sourceFor).toHaveBeenCalledTimes(1)
    expect(source).toHaveBeenCalledTimes(1)

    keyed.subscribe('q', () => {})
    expect(sourceFor).toHaveBeenCalledTimes(2)
    expect(source).toHaveBeenCalledTimes(2)
  })

  it('get() returns the same SharedSubscribable for a key across calls', () => {
    const keyed = new KeyedSharedSubscribable(String, () => () => () => {})
    expect(keyed.get('q')).toBe(keyed.get('q'))
  })

  it('calls onActivate once when the first key becomes active, onDeactivate once when the last one goes idle', () => {
    const onActivate = jest.fn()
    const onDeactivate = jest.fn()
    const keyed = new KeyedSharedSubscribable(String, () => () => () => {}, {
      onActivate,
      onDeactivate,
    })

    const unsubscribeA = keyed.subscribe('a', () => {})
    expect(onActivate).toHaveBeenCalledTimes(1)

    // a second, different key becoming active shouldn't re-trigger onActivate
    const unsubscribeB = keyed.subscribe('b', () => {})
    expect(onActivate).toHaveBeenCalledTimes(1)

    unsubscribeA()
    expect(onDeactivate).toHaveBeenCalledTimes(0) // key 'b' is still active

    unsubscribeB()
    expect(onDeactivate).toHaveBeenCalledTimes(1)

    keyed.subscribe('a', () => {})
    expect(onActivate).toHaveBeenCalledTimes(2)
  })

  describe('invalidate()', () => {
    it('invalidates every cached key, forcing active ones to refetch and notify subscribers with a fresh value', () => {
      const emitters = {}
      const sourceUnsubscribes = { a: jest.fn(), b: jest.fn() }
      const sourceFor = jest.fn((key) => (subscriber) => {
        emitters[key] = subscriber
        return sourceUnsubscribes[key]
      })
      const keyed = new KeyedSharedSubscribable(String, sourceFor)

      const subscriberA = jest.fn()
      const subscriberB = jest.fn()
      keyed.subscribe('a', subscriberA)
      keyed.subscribe('b', subscriberB)
      emitters.a('stale-a')
      emitters.b('stale-b')

      keyed.invalidate()

      expect(sourceUnsubscribes.a).toHaveBeenCalledTimes(1)
      expect(sourceUnsubscribes.b).toHaveBeenCalledTimes(1)
      expect(sourceFor).toHaveBeenCalledTimes(2) // once per key, ever (not re-called by invalidate)

      emitters.a('fresh-a')
      emitters.b('fresh-b')
      expect(subscriberA).toHaveBeenLastCalledWith('fresh-a')
      expect(subscriberB).toHaveBeenLastCalledWith('fresh-b')
    })
  })
})
