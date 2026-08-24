import SharedSubscribable from './index'

describe('SharedSubscribable', () => {
  it('allows a subscription to be passed through', () => {
    let emitValue = null
    const sourceUnsubscribe = jest.fn()
    const source = jest.fn((subscriber) => {
      emitValue = subscriber
      return sourceUnsubscribe
    })

    const shared = new SharedSubscribable(source)
    expect(source).toHaveBeenCalledTimes(0)
    expect(emitValue).toBe(null)
    expect(sourceUnsubscribe).toHaveBeenCalledTimes(0)

    const subscriber = jest.fn()
    const unsubscribe = shared.subscribe(subscriber)

    expect(source).toHaveBeenCalledTimes(1)
    expect(emitValue).not.toBe(null)
    expect(subscriber).toHaveBeenCalledTimes(0)

    emitValue('foo')
    expect(subscriber).toHaveBeenCalledTimes(1)
    expect(subscriber).toHaveBeenLastCalledWith('foo')

    emitValue('bar')
    expect(subscriber).toHaveBeenCalledTimes(2)
    expect(subscriber).toHaveBeenLastCalledWith('bar')

    expect(sourceUnsubscribe).toHaveBeenCalledTimes(0)
    unsubscribe()

    expect(source).toHaveBeenCalledTimes(1)
    expect(sourceUnsubscribe).toHaveBeenCalledTimes(1)
    expect(subscriber).toHaveBeenCalledTimes(2)
  })
  it('can multicast to multiple subscribers', async () => {
    let emitValue = null
    const sourceUnsubscribe = jest.fn()
    const source = jest.fn((subscriber) => {
      emitValue = subscriber
      return sourceUnsubscribe
    })

    const shared = new SharedSubscribable(source)

    const subscriber1 = jest.fn()
    const unsubscribe1 = shared.subscribe(subscriber1)

    const subscriber2 = jest.fn()
    const unsubscribe2 = shared.subscribe(subscriber2)

    const subscriber3 = jest.fn()
    const unsubscribe3 = shared.subscribe(subscriber3)

    emitValue('foo')
    expect(subscriber1).toHaveBeenCalledTimes(1)
    expect(subscriber2).toHaveBeenCalledTimes(1)
    expect(subscriber3).toHaveBeenCalledTimes(1)
    expect(subscriber1).toHaveBeenLastCalledWith('foo')
    expect(subscriber2).toHaveBeenLastCalledWith('foo')

    unsubscribe2()

    emitValue('bar')
    expect(subscriber1).toHaveBeenCalledTimes(2)
    expect(subscriber2).toHaveBeenCalledTimes(1)
    expect(subscriber3).toHaveBeenCalledTimes(2)
    expect(subscriber3).toHaveBeenLastCalledWith('bar')

    unsubscribe3()
    emitValue('baz')
    expect(subscriber1).toHaveBeenCalledTimes(3)
    expect(subscriber2).toHaveBeenCalledTimes(1)
    expect(subscriber3).toHaveBeenCalledTimes(2)

    expect(sourceUnsubscribe).toHaveBeenCalledTimes(0)
    unsubscribe1()
    expect(sourceUnsubscribe).toHaveBeenCalledTimes(1)

    expect(source).toHaveBeenCalledTimes(1)
  })
  it('reemits last value to new subscribers, if any', () => {
    let emitValue = null
    const sourceUnsubscribe = jest.fn()
    const source = jest.fn((subscriber) => {
      emitValue = subscriber
      return sourceUnsubscribe
    })

    const shared = new SharedSubscribable(source)

    const subscriber1 = jest.fn()
    const unsubscribe1 = shared.subscribe(subscriber1)

    emitValue('foo')
    expect(subscriber1).toHaveBeenLastCalledWith('foo')

    const subscriber2 = jest.fn()
    const unsubscribe2 = shared.subscribe(subscriber2)

    expect(subscriber2).toHaveBeenCalledTimes(1)
    expect(subscriber2).toHaveBeenLastCalledWith('foo')

    emitValue('bar')

    const subscriber3 = jest.fn()
    const unsubscribe3 = shared.subscribe(subscriber3)

    expect(subscriber3).toHaveBeenCalledTimes(1)
    expect(subscriber3).toHaveBeenLastCalledWith('bar')

    unsubscribe1()
    unsubscribe2()
    unsubscribe3()
    expect(subscriber1).toHaveBeenCalledTimes(2)
    expect(subscriber2).toHaveBeenCalledTimes(2)
    expect(subscriber3).toHaveBeenCalledTimes(1)
    expect(sourceUnsubscribe).toHaveBeenCalledTimes(1)
  })
  it('source can notify subscriber synchronously with subscription', () => {
    let emitValue = null
    const sourceUnsubscribe = jest.fn()
    const source = jest.fn((subscriber) => {
      subscriber(10)
      emitValue = subscriber
      return sourceUnsubscribe
    })

    const shared = new SharedSubscribable(source)

    const subscriber1 = jest.fn()
    const unsubscribe1 = shared.subscribe(subscriber1)
    expect(subscriber1).toHaveBeenCalledTimes(1)
    expect(subscriber1).toHaveBeenLastCalledWith(10)

    const subscriber2 = jest.fn()
    const unsubscribe2 = shared.subscribe(subscriber2)
    expect(subscriber2).toHaveBeenCalledTimes(1)

    emitValue(20)

    expect(subscriber2).toHaveBeenCalledTimes(2)
    expect(subscriber2).toHaveBeenCalledTimes(2)
    expect(subscriber2).toHaveBeenLastCalledWith(20)

    unsubscribe1()
    unsubscribe2()
    expect(sourceUnsubscribe).toHaveBeenCalledTimes(1)
  })
  it('can resubscribe to source', () => {
    let emitValue = null
    const sourceUnsubscribe = jest.fn()
    const source = jest.fn((subscriber) => {
      emitValue = subscriber
      return sourceUnsubscribe
    })

    const shared = new SharedSubscribable(source)

    const subscriber1 = jest.fn()
    const unsubscribe1 = shared.subscribe(subscriber1)

    emitValue(20)

    const subscriber2 = jest.fn()
    const unsubscribe2 = shared.subscribe(subscriber2)

    unsubscribe1()
    unsubscribe2()
    expect(source).toHaveBeenCalledTimes(1)
    expect(sourceUnsubscribe).toHaveBeenCalledTimes(1)

    const subscriber3 = jest.fn()
    const unsubscribe3 = shared.subscribe(subscriber3)

    expect(source).toHaveBeenCalledTimes(2)
    expect(subscriber3).toHaveBeenCalledTimes(0)

    emitValue('heyey')
    expect(subscriber3).toHaveBeenCalledTimes(1)
    expect(subscriber3).toHaveBeenLastCalledWith('heyey')

    unsubscribe3()
    expect(sourceUnsubscribe).toHaveBeenCalledTimes(2)
  })
  it('too many calls to unsubscribe are safe', () => {
    let emitValue = null
    const sourceUnsubscribe = jest.fn()
    const source = jest.fn((subscriber) => {
      emitValue = subscriber
      return sourceUnsubscribe
    })

    const shared = new SharedSubscribable(source)
    const unsubscribe1 = shared.subscribe(() => {})

    const subscriber2 = jest.fn()
    const unsubscribe2 = shared.subscribe(subscriber2)
    expect(subscriber2).toHaveBeenCalledTimes(0)

    unsubscribe1()
    unsubscribe1()
    expect(sourceUnsubscribe).toHaveBeenCalledTimes(0)

    emitValue('r u der')
    expect(subscriber2).toHaveBeenCalledTimes(1)
    expect(subscriber2).toHaveBeenLastCalledWith('r u der')

    expect(sourceUnsubscribe).toHaveBeenCalledTimes(0)
    unsubscribe2()
    expect(sourceUnsubscribe).toHaveBeenCalledTimes(1)
    unsubscribe2()
    expect(sourceUnsubscribe).toHaveBeenCalledTimes(1)
  })
  it(`can subscribe with the same subscriber multiple times`, () => {
    let emitValue = null
    const source = jest.fn((subscriber) => {
      emitValue = subscriber
      return () => {}
    })
    const shared = new SharedSubscribable(source)
    const subscriber = jest.fn()
    const unsubscribe1 = shared.subscribe(subscriber)
    emitValue()
    expect(subscriber).toHaveBeenCalledTimes(1)
    const unsubscribe2 = shared.subscribe(subscriber)
    expect(subscriber).toHaveBeenCalledTimes(2)
    emitValue()
    expect(subscriber).toHaveBeenCalledTimes(4)
    unsubscribe2()
    unsubscribe2() // noop
    emitValue()
    expect(subscriber).toHaveBeenCalledTimes(5)
    unsubscribe1()
  })
  it('proteccs from rogue sources notifying after being unsubscribed from', () => {
    let emitValue = null
    const sourceUnsubscribe = jest.fn()
    const source = jest.fn((subscriber) => {
      emitValue = subscriber
      return sourceUnsubscribe
    })

    const shared = new SharedSubscribable(source)

    const subscriber1 = jest.fn()
    const unsubscribe1 = shared.subscribe(subscriber1)
    unsubscribe1()
    expect(sourceUnsubscribe).toHaveBeenCalledTimes(1)
    expect(() => emitValue(10)).toThrow('emitted a value after')
    expect(subscriber1).toHaveBeenCalledTimes(0)

    const subscriber2 = jest.fn()
    const unsubscribe2 = shared.subscribe(subscriber2)

    expect(subscriber2).toHaveBeenCalledTimes(0)
    unsubscribe2()
  })
  it('calls onActivate/onDeactivate once per 0<->non-zero transition, not per subscriber', () => {
    const source = jest.fn(() => () => {})
    const onActivate = jest.fn()
    const onDeactivate = jest.fn()

    const shared = new SharedSubscribable(source, { onActivate, onDeactivate })
    expect(onActivate).toHaveBeenCalledTimes(0)

    const unsubscribe1 = shared.subscribe(() => {})
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onDeactivate).toHaveBeenCalledTimes(0)

    // a second, third subscriber shouldn't trigger onActivate again
    const unsubscribe2 = shared.subscribe(() => {})
    const unsubscribe3 = shared.subscribe(() => {})
    expect(onActivate).toHaveBeenCalledTimes(1)

    unsubscribe1()
    unsubscribe2()
    expect(onDeactivate).toHaveBeenCalledTimes(0)

    // last subscriber leaving triggers onDeactivate
    unsubscribe3()
    expect(onDeactivate).toHaveBeenCalledTimes(1)

    // resubscribing triggers onActivate again
    shared.subscribe(() => {})
    expect(onActivate).toHaveBeenCalledTimes(2)
  })
  describe('invalidate()', () => {
    it('is a no-op when there are no subscribers', () => {
      const source = jest.fn(() => () => {})
      const shared = new SharedSubscribable(source)
      expect(() => shared.invalidate()).not.toThrow()
      expect(source).toHaveBeenCalledTimes(0)
    })
    it('forgets the last emission and does not replay it to subsequent subscribers if there are no active subscribers', () => {
      let emit = null
      const source = jest.fn((subscriber) => {
        emit = subscriber
        return () => {}
      })
      const shared = new SharedSubscribable(source)

      const unsubscribe = shared.subscribe(() => {})
      emit('stale')
      unsubscribe()

      shared.invalidate()

      const subscriber = jest.fn()
      shared.subscribe(subscriber)
      expect(subscriber).toHaveBeenCalledTimes(0)
      // subscribing after invalidate() with no active subscribers re-runs the source, same as normal
      expect(source).toHaveBeenCalledTimes(2)
    })
    it('re-subscribes to the source and notifies active subscribers with a fresh value, discarding the stale one', () => {
      let emit = null
      const sourceUnsubscribe = jest.fn()
      const source = jest.fn((subscriber) => {
        emit = subscriber
        return sourceUnsubscribe
      })
      const shared = new SharedSubscribable(source)

      const subscriber = jest.fn()
      shared.subscribe(subscriber)
      emit('stale')
      expect(subscriber).toHaveBeenLastCalledWith('stale')

      shared.invalidate()
      expect(sourceUnsubscribe).toHaveBeenCalledTimes(1)
      expect(source).toHaveBeenCalledTimes(2)
      // no fresh value yet -- source hasn't emitted since being re-subscribed
      expect(subscriber).toHaveBeenCalledTimes(1)

      emit('fresh')
      expect(subscriber).toHaveBeenLastCalledWith('fresh')
    })
    it('does not call onActivate/onDeactivate (subscriber list is unaffected)', () => {
      const source = jest.fn(() => () => {})
      const onActivate = jest.fn()
      const onDeactivate = jest.fn()
      const shared = new SharedSubscribable(source, { onActivate, onDeactivate })

      shared.subscribe(() => {})
      expect(onActivate).toHaveBeenCalledTimes(1)

      shared.invalidate()
      expect(onActivate).toHaveBeenCalledTimes(1)
      expect(onDeactivate).toHaveBeenCalledTimes(0)
    })
  })
})
