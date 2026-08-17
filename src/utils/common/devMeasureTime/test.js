describe('getPreciseTime', () => {
  const originalWindow = global.window
  const originalNativePerformanceNow = global.nativePerformanceNow

  const restoreGlobals = () => {
    if (originalWindow === undefined) {
      delete global.window
    } else {
      global.window = originalWindow
    }
    if (originalNativePerformanceNow === undefined) {
      delete global.nativePerformanceNow
    } else {
      global.nativePerformanceNow = originalNativePerformanceNow
    }
  }

  afterEach(() => {
    restoreGlobals()
  })

  const loadGetPreciseTime = () => {
    let getPreciseTime
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      ;({ getPreciseTime } = require('./index'))
    })
    return getPreciseTime
  }

  it('does not throw when window.performance.now exists but is not a function', () => {
    delete global.nativePerformanceNow
    global.window = {
      performance: {
        now: 12345,
      },
    }

    const getPreciseTime = loadGetPreciseTime()
    expect(typeof getPreciseTime()).toBe('number')
  })

  it('uses window.performance.now when it is a function', () => {
    delete global.nativePerformanceNow
    const now = jest.fn(() => 42)
    global.window = {
      performance: { now },
    }

    const getPreciseTime = loadGetPreciseTime()
    expect(getPreciseTime()).toBe(42)
    expect(now).toHaveBeenCalled()
  })
})
