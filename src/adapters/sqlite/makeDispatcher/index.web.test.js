jest.mock('../sqlite-wasm/wa-sqlite-async.wasm', () => '/assets/wa-sqlite-async.wasm')

import { getDispatcherType, makeDispatcher } from './index.web'

describe('wa-sqlite web dispatcher', () => {
  afterEach(() => {
    delete global.window
    delete global.Worker
  })

  it('reports its public dispatcher type', () => {
    expect(getDispatcherType({})).toBe('wa-sqlite')
  })

  it('is safe to initialize during SSR and rejects server operations', () => {
    const dispatcher = makeDispatcher('wa-sqlite', 1, 'test', {
      usesExclusiveLocking: false,
      experimentalUnsafeNativeReuse: false,
    })
    const initialized = jest.fn()
    dispatcher.call('initialize', ['test', 1], initialized)
    expect(initialized).toHaveBeenCalledWith({ value: { code: 'ok' } })

    const queried = jest.fn()
    dispatcher.call('count', ['select 1', []], queried)
    expect(queried.mock.calls[0][0].error.message).toContain('client-only')
  })

  it('rejects exclusive locking', () => {
    expect(() =>
      makeDispatcher('wa-sqlite', 1, 'test', {
        usesExclusiveLocking: true,
        experimentalUnsafeNativeReuse: false,
      }),
    ).toThrow('usesExclusiveLocking is not supported')
  })

  it('fails browser initialization clearly when workers are unavailable', () => {
    global.window = { location: { href: 'https://app.example.test/' } }
    const dispatcher = makeDispatcher('wa-sqlite', 1, 'test', {
      usesExclusiveLocking: false,
      experimentalUnsafeNativeReuse: false,
    })
    const initialized = jest.fn()
    dispatcher.call('initialize', ['test', 1], initialized)
    expect(initialized.mock.calls[0][0].error.message).toContain('requires Web Workers')
  })

  it('uses override URLs, completes callbacks once, and recovers after a worker crash', async () => {
    class FakeWorker {
      listeners = {}
      requests = []
      terminate = jest.fn()

      addEventListener(type, listener) {
        this.listeners[type] = listener
      }

      postMessage(request) {
        this.requests.push(request)
      }

      emit(type, value) {
        this.listeners[type](value)
      }
    }

    global.window = { location: { href: 'https://app.example.test/dashboard' } }
    global.Worker = FakeWorker
    const workers = []
    const workerFactory = () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    }
    const dispatcher = makeDispatcher('wa-sqlite', 9, 'test', {
      usesExclusiveLocking: false,
      experimentalUnsafeNativeReuse: false,
      web: { wasmUrl: '/custom/sqlite.wasm', workerFactory },
    })

    const first = jest.fn()
    dispatcher.call('initialize', ['test', 1], first)
    expect(workers[0].requests[0]).toMatchObject({
      id: 1,
      tag: 9,
      wasmUrl: 'https://app.example.test/custom/sqlite.wasm',
    })
    workers[0].emit('error', { message: 'worker stopped' })
    await Promise.resolve()
    expect(workers[0].terminate).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
    expect(first.mock.calls[0][0].error.message).toBe('worker stopped')

    const second = jest.fn()
    dispatcher.call('initialize', ['test', 1], second)
    expect(workers).toHaveLength(2)
    const response = { data: { id: 1, value: { code: 'ok' } } }
    workers[1].emit('message', response)
    workers[1].emit('message', response)
    await Promise.resolve()
    expect(second).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledWith({ value: { code: 'ok' } })
  })

  it('queues operations until two-phase schema setup completes', async () => {
    class FakeWorker {
      listeners = {}
      requests = []

      addEventListener(type, listener) {
        this.listeners[type] = listener
      }

      postMessage(request) {
        this.requests.push(request)
      }

      emitResponse(id, value) {
        this.listeners.message({ data: { id, value } })
      }

      terminate() {}
    }

    global.window = { location: { href: 'https://app.example.test/' } }
    global.Worker = FakeWorker
    const worker = new FakeWorker()
    const dispatcher = makeDispatcher('wa-sqlite', 42, 'test', {
      usesExclusiveLocking: false,
      experimentalUnsafeNativeReuse: false,
      web: { wasmUrl: '/sqlite.wasm', workerFactory: () => worker },
    })

    const initialized = jest.fn()
    const counted = jest.fn()
    dispatcher.call('initialize', ['test', 1], initialized)
    dispatcher.call('count', ['select count(*) from tasks', []], counted)
    expect(worker.requests.map(({ method }) => method)).toEqual(['initialize'])

    worker.emitResponse(1, { code: 'schema_needed' })
    await Promise.resolve()
    expect(initialized).toHaveBeenCalledWith({ value: { code: 'schema_needed' } })
    expect(worker.requests.map(({ method }) => method)).toEqual(['initialize'])

    const setUp = jest.fn()
    dispatcher.call('setUpWithSchema', ['test', 'create table tasks (id);', 1], setUp)
    expect(worker.requests.map(({ method }) => method)).toEqual([
      'initialize',
      'setUpWithSchema',
    ])

    worker.emitResponse(2, undefined)
    await Promise.resolve()
    expect(setUp).toHaveBeenCalledWith({ value: undefined })
    expect(worker.requests.map(({ method }) => method)).toEqual([
      'initialize',
      'setUpWithSchema',
      'count',
    ])

    worker.emitResponse(3, 0)
    await Promise.resolve()
    expect(counted).toHaveBeenCalledWith({ value: 0 })
  })
})
