import asyncToGenerator from '@babel/runtime/helpers/asyncToGenerator'
import { createAsyncVariable } from '.'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

describe('createAsyncVariable', () => {
  it('prefers AsyncLocalStorage on Node', () => {
    expect(createAsyncVariable().kind).toBe('AsyncLocalStorage')
  })

  it('prefers native AsyncContext when present', () => {
    const values = []
    class Variable {
      run(value, fn) {
        values.push(value)
        try {
          return fn()
        } finally {
          values.pop()
        }
      }

      get() {
        return values[values.length - 1]
      }
    }
    global.AsyncContext = { Variable }
    try {
      const variable = createAsyncVariable()
      expect(variable.kind).toBe('AsyncContext')
      expect(variable.run('a', () => variable.get())).toBe('a')
      expect(variable.get()).toBe(undefined)
    } finally {
      delete global.AsyncContext
    }
  })

  it('returns null for a forced kind that is unavailable', () => {
    expect(createAsyncVariable('AsyncContext')).toBe(null)
  })

  describe.each(['AsyncLocalStorage', 'promise-then'])('%s', (kind) => {
    it('follows a value through awaits, helpers and .then() chains', async () => {
      const variable = createAsyncVariable(kind)
      const seen = []
      const helper = async () => {
        await delay(1)
        seen.push(variable.get())
        return Promise.resolve().then(() => variable.get())
      }
      await variable.run('a', async () => {
        await Promise.resolve()
        seen.push(variable.get())
        seen.push(await helper())
      })
      expect(seen).toEqual(['a', 'a', 'a'])
      expect(variable.get()).toBe(undefined)
    })

    it('keeps concurrent flows separate', async () => {
      const variable = createAsyncVariable(kind)
      const flow = (value) =>
        variable.run(value, async () => {
          await delay(value === 'a' ? 5 : 1)
          const first = variable.get()
          await delay(value === 'a' ? 1 : 5)
          return [first, variable.get()]
        })
      expect(await Promise.all([flow('a'), flow('b')])).toEqual([
        ['a', 'a'],
        ['b', 'b'],
      ])
    })

    it('does not leak into code that was not started by the flow', async () => {
      const variable = createAsyncVariable(kind)
      let resolveOutside
      const outside = new Promise((resolve) => {
        resolveOutside = resolve
      })
      // registered outside of run() -- must not see the value even though it runs while the
      // flow is still in progress
      const outsideSeen = outside.then(() => variable.get())
      await variable.run('a', async () => {
        resolveOutside()
        await delay(1)
      })
      expect(await outsideSeen).toBe(undefined)
    })

    it('can be unset for a nested section with run(undefined)', async () => {
      const variable = createAsyncVariable(kind)
      const seen = await variable.run('a', () =>
        variable.run(undefined, async () => {
          await delay(1)
          return variable.get()
        }),
      )
      expect(seen).toBe(undefined)
    })

    it('restores the previous value when the callback throws', () => {
      const variable = createAsyncVariable(kind)
      variable.run('a', () => {
        expect(() =>
          variable.run('b', () => {
            throw new Error('boom')
          }),
        ).toThrow('boom')
        expect(variable.get()).toBe('a')
      })
      expect(variable.get()).toBe(undefined)
    })

    it('follows Babel async-to-generator output (React Native)', async () => {
      const variable = createAsyncVariable(kind)
      const inner = asyncToGenerator(function* () {
        yield delay(1)
        return variable.get()
      })
      const outer = asyncToGenerator(function* () {
        yield Promise.resolve()
        const fromInner = yield inner()
        yield delay(1)
        return [fromInner, variable.get()]
      })
      expect(await variable.run('a', () => outer())).toEqual(['a', 'a'])
    })
  })

  describe('promise-then', () => {
    it('patches Promise.prototype.then only once, keeping it non-enumerable', () => {
      createAsyncVariable('promise-then')
      const patched = Promise.prototype.then
      createAsyncVariable('promise-then')
      expect(Promise.prototype.then).toBe(patched)
      expect(Object.keys(Promise.prototype)).not.toContain('then')
    })

    it('keeps variables independent', async () => {
      const a = createAsyncVariable('promise-then')
      const b = createAsyncVariable('promise-then')
      const seen = await a.run(1, () =>
        b.run(2, async () => {
          await delay(1)
          return [a.get(), b.get()]
        }),
      )
      expect(seen).toEqual([1, 2])
      expect([a.get(), b.get()]).toEqual([undefined, undefined])
    })

    it('passes through non-function callbacks and preserves rejections', async () => {
      const variable = createAsyncVariable('promise-then')
      await variable.run('a', async () => {
        expect(await Promise.resolve(1).then(null, null)).toBe(1)
        await expect(Promise.reject(new Error('nope')).then(() => 'unreachable')).rejects.toThrow(
          'nope',
        )
        const caught = await Promise.reject(new Error('caught')).catch(() => variable.get())
        expect(caught).toBe('a')
      })
    })
  })
})
