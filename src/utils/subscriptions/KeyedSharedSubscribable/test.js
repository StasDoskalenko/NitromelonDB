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

  it('re-subscribes to the source once a key has no more subscribers', () => {
    // sourceFor (the factory) runs once per key, ever — it's the source
    // function *it returns* that SharedSubscribable re-invokes each time a
    // key goes from zero subscribers back to one.
    const source = jest.fn(() => () => {})
    const sourceFor = jest.fn(() => source)
    const keyed = new KeyedSharedSubscribable(String, sourceFor)

    const unsubscribe1 = keyed.subscribe('q', () => {})
    unsubscribe1()
    expect(sourceFor).toHaveBeenCalledTimes(1)
    expect(source).toHaveBeenCalledTimes(1)

    keyed.subscribe('q', () => {})
    expect(sourceFor).toHaveBeenCalledTimes(1)
    expect(source).toHaveBeenCalledTimes(2)
  })

  it('get() returns the same SharedSubscribable for a key across calls', () => {
    const keyed = new KeyedSharedSubscribable(String, () => () => () => {})
    expect(keyed.get('q')).toBe(keyed.get('q'))
  })
})
