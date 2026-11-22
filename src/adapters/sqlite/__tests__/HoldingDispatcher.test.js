import HoldingDispatcher from '../HoldingDispatcher'

// A target that answers synchronously, like Nitro, and logs what reached it
function makeTarget() {
  const calls = []
  return {
    calls,
    call(methodName, args, callback) {
      calls.push(methodName)
      callback({ value: `${methodName}:${args.join(',')}` })
    },
  }
}

describe('HoldingDispatcher', () => {
  it('holds calls until there is a target, then sends them in order', () => {
    const holding = new HoldingDispatcher()
    const answers = []
    holding.call('a', [1], (result) => answers.push(result.value))
    holding.call('b', [2], (result) => answers.push(result.value))
    expect(answers).toEqual([])

    const target = makeTarget()
    holding.setTarget(target)
    expect(target.calls).toEqual(['a', 'b'])
    expect(answers).toEqual(['a:1', 'b:2'])

    // then passes calls straight through
    holding.call('c', [3], (result) => answers.push(result.value))
    expect(answers).toEqual(['a:1', 'b:2', 'c:3'])
  })

  it('sends a call made from the callback of a held call right away, like a synchronous dispatcher', () => {
    // SQLiteAdapter's setup: initialize's callback calls setUpWithSchema, which must run before the
    // app's calls that were held behind initialize
    const holding = new HoldingDispatcher()
    const target = makeTarget()
    holding.call('initialize', [], () => {
      holding.call('setUpWithSchema', [], () => {})
    })
    holding.call('getLocal', [], () => {})
    holding.setTarget(target)
    expect(target.calls).toEqual(['initialize', 'setUpWithSchema', 'getLocal'])

    // once nothing is held, calls go straight through
    holding.call('query', [], () => {})
    expect(target.calls).toEqual(['initialize', 'setUpWithSchema', 'getLocal', 'query'])
  })

  it('keeps later calls behind held ones while still held', () => {
    const holding = new HoldingDispatcher()
    const target = makeTarget()
    holding.setTarget(target)
    const release = holding.hold()
    holding.call('a', [], () => {})
    holding.call('b', [], () => {})
    release()
    holding.call('c', [], () => {})
    expect(target.calls).toEqual(['a', 'b', 'c'])
  })

  it('fails every held call, and every later one, with the error', () => {
    const holding = new HoldingDispatcher()
    const errors = []
    holding.call('a', [], (result) => errors.push(result.error))
    holding.call('b', [], (result) => errors.push(result.error))
    const error = new Error('no passphrase')
    holding.fail(error)
    holding.call('c', [], (result) => errors.push(result.error))
    holding.callNow('d', [], (result) => errors.push(result.error))
    expect(errors).toEqual([error, error, error, error])
  })

  it('holds calls while held, but lets callNow through', () => {
    const holding = new HoldingDispatcher()
    const target = makeTarget()
    holding.setTarget(target)

    const release = holding.hold()
    holding.call('waits', [], () => {})
    holding.callNow('now', [], () => {})
    expect(target.calls).toEqual(['now'])

    release()
    release() // twice is harmless
    expect(target.calls).toEqual(['now', 'waits'])
  })

  it('stops sending held calls when a callback holds again', () => {
    const holding = new HoldingDispatcher()
    const target = makeTarget()
    holding.setTarget(target)
    let releaseSecond
    const release = holding.hold()
    holding.call('a', [], () => {
      releaseSecond = holding.hold()
    })
    holding.call('b', [], () => {})
    release()
    expect(target.calls).toEqual(['a'])
    releaseSecond()
    expect(target.calls).toEqual(['a', 'b'])
  })

  it('callNow before there is a target fails instead of waiting', () => {
    const holding = new HoldingDispatcher()
    const results = []
    holding.callNow('a', [], (result) => results.push(result))
    expect(results[0].error.message).toMatch(/isn't open yet/)
  })
})
