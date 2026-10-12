// experimentalDetectNestedWriters: nested write()/read() calls without callWriter()/callReader()
// must throw -- not deadlock -- no matter how many unrelated awaits come first (#154), while
// independent readers/writers keep queueing normally.
//
// Every scenario runs once per async-context tier the detector can use: AsyncLocalStorage (what
// Node/Jest get by default) and promise-then (what Hermes/React Native get). This file's own async
// functions are compiled to `.then()` chains by the library's Babel config (fast-async), much like
// React Native's async-to-generator transform -- the RN-specific shape is also tested explicitly
// below with Babel's real asyncToGenerator helper.
import asyncToGenerator from '@babel/runtime/helpers/asyncToGenerator'
import { mockDatabase } from '../__tests__/testModels'
import { createAsyncVariable } from '../utils/common/asyncContext'

const NESTED_ERROR = /without callWriter\(\)\/callReader\(\)\. This deadlocks\./

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Fails fast with a clear message instead of hanging until Jest's timeout if detection regresses
// (a missed nested call deadlocks forever by definition)
const settleWithin = (promise, ms = 1000) => {
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`deadlocked: not settled within ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

describe.each(['AsyncLocalStorage', 'promise-then'])('nested writer detection (%s)', (kind) => {
  const setup = () => {
    const env = mockDatabase({ experimentalDetectNestedWriters: true })
    env.database._workQueue._workContext = createAsyncVariable(kind)
    expect(env.database._workQueue._workContext.kind).toBe(kind)
    return env
  }

  it('throws on a synchronous nested write', async () => {
    const { database } = setup()
    await expect(
      settleWithin(
        database.write(async () => {
          await database.write(async () => 1)
        }),
      ),
    ).rejects.toThrow(NESTED_ERROR)
  })

  it('throws on a nested write after an unrelated await (issue #154 repro)', async () => {
    const { database } = setup()
    await expect(
      settleWithin(
        database.write(async () => {
          await Promise.resolve()
          await database.write(async () => 1)
        }),
      ),
    ).rejects.toThrow(NESTED_ERROR)
  })

  it('throws on a nested write after awaiting a timer', async () => {
    const { database } = setup()
    await expect(
      settleWithin(
        database.write(async () => {
          await delay(5)
          await delay(5)
          await database.write(async () => 1)
        }, 'outer writer'),
      ),
    ).rejects.toThrow(/called from writer \(outer writer\)/)
  })

  it('throws when the nested call is deep inside awaited helpers', async () => {
    const { database, tasks } = setup()
    const saveTask = async () => {
      await delay(1)
      return database.write(() => tasks.create(), 'saveTask')
    }
    const syncThenSave = async () => {
      await Promise.resolve()
      await delay(1)
      return saveTask()
    }
    await expect(
      settleWithin(database.write(async () => syncThenSave(), 'outer writer')),
    ).rejects.toThrow(/Nested writer \(saveTask\) called from writer \(outer writer\)/)
  })

  it('throws on nested calls made from .then() chains and Promise.all', async () => {
    const { database } = setup()
    await expect(
      settleWithin(
        database.write(() => Promise.resolve().then(() => database.write(async () => 1))),
      ),
    ).rejects.toThrow(NESTED_ERROR)
    await expect(
      settleWithin(
        database.write(async () => {
          await Promise.all(
            [1, 2].map(async (n) => {
              await delay(n)
              return database.read(async () => n)
            }),
          )
        }),
      ),
    ).rejects.toThrow(NESTED_ERROR)
  })

  it('throws on nested readers, and writers inside readers, after awaits', async () => {
    const { database } = setup()
    await expect(
      settleWithin(
        database.write(async () => {
          await delay(1)
          await database.read(async () => 1)
        }),
      ),
    ).rejects.toThrow(/Nested reader \(unnamed\) called from writer/)
    await expect(
      settleWithin(
        database.read(async () => {
          await delay(1)
          await database.write(async () => 1)
        }),
      ),
    ).rejects.toThrow(/Nested writer \(unnamed\) called from reader/)
  })

  it('throws after awaiting NitromelonDB queries and writes', async () => {
    const { database, tasks } = setup()
    await expect(
      settleWithin(
        database.write(async () => {
          const task = await tasks.create()
          await task.update(() => {})
          await tasks.query().fetch()
          await delay(1)
          await database.write(async () => 1)
        }),
      ),
    ).rejects.toThrow(NESTED_ERROR)
  })

  it('throws when a nested write is returned (not awaited) from the writer', async () => {
    const { database } = setup()
    await expect(
      settleWithin(
        database.write(async () => {
          await delay(1)
          return database.write(async () => 1)
        }),
      ),
    ).rejects.toThrow(NESTED_ERROR)
  })

  it('lets a writer queue a nested writer it does not wait for (fire-and-forget)', async () => {
    const { database } = setup()
    const order = []
    let nested
    await settleWithin(
      database.write(async () => {
        await delay(1)
        nested = database.write(async () => {
          order.push('nested')
          return 'nested'
        })
        await delay(1)
        order.push('outer')
      }),
    )
    expect(await settleWithin(nested)).toBe('nested')
    expect(order).toEqual(['outer', 'nested'])
  })

  it('keeps nested promises usable by Promise implementations that call `new this.constructor`', async () => {
    // Hermes' Promise#then does this instead of a spec species lookup
    const { database } = setup()
    let nested
    await database.write(async () => {
      await delay(1)
      nested = database.write(async () => 'nested')
    })
    const Derived = nested.constructor
    expect(Derived).not.toBe(Promise)
    const derived = new Derived((resolve) => resolve(1))
    expect(derived).toBeInstanceOf(Promise)
    expect(await derived).toBe(1)
    expect(Derived[Symbol.species]).toBe(Promise)
    expect(await settleWithin(nested)).toBe('nested')
  })

  it('removes a nested call it rejected from the queue', async () => {
    const { database } = setup()
    let ran = false
    await expect(
      settleWithin(
        database.write(async () => {
          await delay(1)
          await database.write(async () => {
            ran = true
          })
        }),
      ),
    ).rejects.toThrow(NESTED_ERROR)
    await settleWithin(database.read(async () => {}))
    expect(ran).toBe(false)
    expect(database._workQueue._queue).toHaveLength(0)
  })

  it('still allows callWriter()/callReader() after any awaits', async () => {
    const { database, tasks } = setup()
    const nestedWriter = () => database.write(() => tasks.create(), 'nested writer')
    const nestedReader = () => database.read(() => tasks.query().fetchCount(), 'nested reader')
    const count = await settleWithin(
      database.write(async (writer) => {
        await delay(1)
        await writer.callWriter(() => nestedWriter())
        await Promise.resolve()
        return writer.callReader(() => nestedReader())
      }),
    )
    expect(count).toBe(1)
  })

  it('still throws on a raw nested write from inside a callWriter()-ed writer', async () => {
    const { database } = setup()
    const middle = () =>
      database.write(async () => {
        await delay(1)
        await database.write(async () => 1)
      }, 'middle')
    await expect(
      settleWithin(database.write(async (writer) => writer.callWriter(() => middle()))),
    ).rejects.toThrow(NESTED_ERROR)
  })

  it('lets independent writers queue while one is awaiting', async () => {
    const { database } = setup()
    const order = []
    let releaseFirst
    const first = database.write(async () => {
      await new Promise((resolve) => {
        releaseFirst = resolve
      })
      order.push('first')
    })
    // Started from outside the first writer (e.g. a button press) -- must queue, not throw
    await delay(5)
    const second = database.write(async () => {
      order.push('second')
    })
    const third = database.read(async () => {
      order.push('third')
    })
    releaseFirst()
    await settleWithin(Promise.all([first, second, third]))
    expect(order).toEqual(['first', 'second', 'third'])
  })

  it('lets a continuation of a finished writer start a new writer', async () => {
    const { database } = setup()
    let releaseLater
    const later = new Promise((resolve) => {
      releaseLater = resolve
    })
    let followUp
    await database.write(async () => {
      // registered inside the writer, but only runs after the writer is done
      followUp = later.then(() => database.write(async () => 'follow-up'))
    })
    releaseLater()
    expect(await settleWithin(followUp)).toBe('follow-up')
  })

  it('lets observers react to a writer by starting their own writer', async () => {
    const { database, tasks } = setup()
    const reactions = []
    const subscription = database.withChangesForTables(['mock_tasks']).subscribe((changes) => {
      if (changes) {
        reactions.push(
          database.write(async () => {
            await delay(1)
            return 'reaction'
          }),
        )
      }
    })
    await settleWithin(
      database.write(async () => {
        await delay(1)
        await tasks.create()
        await delay(1)
      }),
    )
    expect(reactions).toHaveLength(1)
    expect(await settleWithin(reactions[0])).toBe('reaction')
    subscription.unsubscribe()
  })

  it('follows awaits compiled by Babel async-to-generator (React Native output)', async () => {
    const { database } = setup()
    // Equivalent of an RN-compiled `async () => { await delay(1); await Promise.resolve();
    // await database.write(...) }`
    const work = asyncToGenerator(function* () {
      yield delay(1)
      yield Promise.resolve()
      yield database.write(
        // eslint-disable-next-line require-yield
        asyncToGenerator(function* () {
          return 1
        }),
      )
    })
    await expect(settleWithin(database.write(work))).rejects.toThrow(NESTED_ERROR)

    const allowed = asyncToGenerator(function* (writer) {
      yield delay(1)
      return yield writer.callWriter(() =>
        database.write(
          // eslint-disable-next-line require-yield
          asyncToGenerator(function* () {
            return 42
          }),
        ),
      )
    })
    expect(await settleWithin(database.write(allowed))).toBe(42)
  })
})

describe('nested writer detection with native (untranspiled) await', () => {
  // This file's async functions are compiled by Babel; `new Function` gets engine-native ones.
  // A native `await` of an unmodified native promise never reads `then`, which is why nested
  // promises get their `constructor` replaced (see WorkQueue#_guardNested).
  // eslint-disable-next-line no-new-func
  const nativeWriter = new Function(
    'database',
    'delay',
    `return async () => {
      await delay(1)
      await Promise.resolve()
      await database.write(async () => 1)
    }`,
  )

  it('throws on AsyncLocalStorage', async () => {
    const { database } = mockDatabase({ experimentalDetectNestedWriters: true })
    expect(database._workQueue._getWorkContext().kind).toBe('AsyncLocalStorage')
    await expect(settleWithin(database.write(nativeWriter(database, delay)))).rejects.toThrow(
      NESTED_ERROR,
    )
  })
})

describe('nested writer detection, flag off', () => {
  it('does not create an async context', async () => {
    const { database } = mockDatabase()
    await database.write(async () => {
      await delay(1)
    })
    expect(database._workQueue._workContext).toBe(null)
  })
})
