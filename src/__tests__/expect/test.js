// Tests for the standalone `expect` shim used by the RN integration-test bundle.
// Run under Jest, using Jest's own `expect` to check the shim (`e`).

import e from './index'

const throws = (fn) => {
  try {
    fn()
    return false
  } catch (_err) {
    return true
  }
}

describe('expect shim', () => {
  it('toBe / not.toBe', () => {
    expect(throws(() => e(1).toBe(1))).toBe(false)
    expect(throws(() => e(1).toBe(2))).toBe(true)
    expect(throws(() => e({}).not.toBe({}))).toBe(false)
    expect(throws(() => e(1).not.toBe(1))).toBe(true)
    const raw = { id: 'a' }
    expect(throws(() => e({ id: 'a' }).not.toBe(raw))).toBe(false)
  })

  it('toEqual deep-compares and ignores undefined props', () => {
    expect(throws(() => e(['s1', 's2']).toEqual(['s1', 's2']))).toBe(false)
    expect(throws(() => e([]).toEqual([]))).toBe(false)
    expect(throws(() => e({ a: 1, b: undefined }).toEqual({ a: 1 }))).toBe(false)
    expect(throws(() => e({ a: 1, b: { c: 2 } }).toEqual({ a: 1, b: { c: 3 } }))).toBe(true)
    expect(throws(() => e({ timestamp: 1000 }).toEqual({ timestamp: 1000 }))).toBe(false)
  })

  it('toEqual with expect.arrayContaining', () => {
    expect(throws(() => e(['t1', 't2', 't3']).toEqual(e.arrayContaining(['t1', 't2'])))).toBe(false)
    expect(throws(() => e(['t1']).toEqual(e.arrayContaining(['t1', 't2'])))).toBe(true)
  })

  it('toHaveLength / toBeNull / toBeTruthy / toBeInstanceOf', () => {
    expect(throws(() => e([1, 2]).toHaveLength(2))).toBe(false)
    expect(throws(() => e([1, 2]).toHaveLength(3))).toBe(true)
    expect(throws(() => e(null).toBeNull())).toBe(false)
    expect(throws(() => e(5).not.toBeNull())).toBe(false)
    expect(throws(() => e('x').toBeTruthy())).toBe(false)
    expect(throws(() => e(0).toBeTruthy())).toBe(true)
    expect(throws(() => e(new Error('x')).toBeInstanceOf(Error))).toBe(false)
    expect(throws(() => e({}).toBeInstanceOf(Error))).toBe(true)
  })

  it('toBeGreaterThan / toBeGreaterThanOrEqual', () => {
    expect(throws(() => e(5).toBeGreaterThan(4))).toBe(false)
    expect(throws(() => e(5).toBeGreaterThan(5))).toBe(true)
    expect(throws(() => e(5).toBeGreaterThanOrEqual(5))).toBe(false)
  })

  it('toContain (array + string)', () => {
    expect(throws(() => e(['t1', 't2']).toContain('t2'))).toBe(false)
    expect(throws(() => e(['t1']).toContain('t2'))).toBe(true)
    expect(throws(() => e('locked database').toContain('locked'))).toBe(false)
  })

  it('toMatch (string + regex)', () => {
    expect(throws(() => e('database is locked').toMatch(/locked/i))).toBe(false)
    expect(throws(() => e('all good').toMatch(/locked/))).toBe(true)
  })

  it('toMatchObject with asymmetric matcher', () => {
    expect(
      throws(() =>
        e({ id: 'rec1', text1: 'bar', extra: 1 }).toMatchObject({ id: 'rec1', text1: 'bar' }),
      ),
    ).toBe(false)
    expect(throws(() => e({ id: 'rec1' }).toMatchObject({ id: 'rec2' }))).toBe(true)
    const err = new Error('table is locked')
    expect(throws(() => e(err).toMatchObject({ message: e.stringMatching(/locked/) }))).toBe(false)
    expect(throws(() => e(err).toMatchObject({ message: e.stringMatching('missing') }))).toBe(true)
  })

  it('toThrow / not.toThrow', () => {
    expect(
      throws(() =>
        e(() => {
          throw new Error('boom')
        }).toThrow(),
      ),
    ).toBe(false)
    expect(throws(() => e(() => {}).toThrow())).toBe(true)
    expect(throws(() => e(() => {}).not.toThrow())).toBe(false)
    expect(
      throws(() =>
        e(() => {
          throw new Error('boom')
        }).not.toThrow(),
      ),
    ).toBe(true)
    expect(
      throws(() =>
        e(() => {
          throw new Error('boom')
        }).toThrow(/boom/),
      ),
    ).toBe(false)
  })

  it('rejects.toBeInstanceOf', async () => {
    await e(Promise.reject(new Error('x'))).rejects.toBeInstanceOf(Error)
    let failed = false
    try {
      await e(Promise.resolve('ok')).rejects.toBeInstanceOf(Error)
    } catch (_err) {
      failed = true
    }
    expect(failed).toBe(true)
  })

  it('rejects.toThrow', async () => {
    await e(Promise.reject(new Error('nope'))).rejects.toThrow()
  })

  it('rejects.toMatchObject with stringMatching', async () => {
    await e(Promise.reject(new Error('db is locked'))).rejects.toMatchObject({
      message: e.stringMatching(/locked/),
    })
  })
})
