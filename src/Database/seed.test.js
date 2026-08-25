import { databaseSeed } from './seed'

describe('databaseSeed()', () => {
  it('returns a validated spec with steps sorted by schemaVersion', () => {
    const step1 = { schemaVersion: 1, run: async () => {} }
    const step2 = { schemaVersion: 2, run: async () => {} }

    const seed = databaseSeed({ steps: [step2, step1] })

    expect(seed).toEqual({
      validated: true,
      sortedSteps: [step1, step2],
      onError: undefined,
    })
  })

  it('carries onError through', () => {
    const onError = () => {}
    const seed = databaseSeed({ steps: [{ schemaVersion: 1, run: async () => {} }], onError })
    expect(seed.onError).toBe(onError)
  })

  it('throws if steps is missing or empty', () => {
    expect(() => databaseSeed({ steps: [] })).toThrow('at least one step')
    expect(() => databaseSeed({})).toThrow('at least one step')
  })

  it('throws on a non-integer or non-positive schemaVersion', () => {
    expect(() => databaseSeed({ steps: [{ schemaVersion: 0, run: async () => {} }] })).toThrow(
      'schemaVersion must be a positive integer',
    )
    expect(() => databaseSeed({ steps: [{ schemaVersion: 1.5, run: async () => {} }] })).toThrow(
      'schemaVersion must be a positive integer',
    )
  })

  it('throws if run is not a function', () => {
    expect(() => databaseSeed({ steps: [{ schemaVersion: 1, run: null }] })).toThrow(
      'run must be a function',
    )
  })

  it('throws on a negative or non-integer retries value', () => {
    expect(() =>
      databaseSeed({ steps: [{ schemaVersion: 1, run: async () => {}, retries: -1 }] }),
    ).toThrow('retries must be a non-negative integer')
    expect(() =>
      databaseSeed({ steps: [{ schemaVersion: 1, run: async () => {}, retries: 1.5 }] }),
    ).toThrow('retries must be a non-negative integer')
  })

  it('allows retries to be omitted or 0', () => {
    expect(() =>
      databaseSeed({ steps: [{ schemaVersion: 1, run: async () => {}, retries: 0 }] }),
    ).not.toThrow()
    expect(() => databaseSeed({ steps: [{ schemaVersion: 1, run: async () => {} }] })).not.toThrow()
  })

  it('throws on duplicate schemaVersion across steps', () => {
    expect(() =>
      databaseSeed({
        steps: [
          { schemaVersion: 1, run: async () => {} },
          { schemaVersion: 1, run: async () => {} },
        ],
      }),
    ).toThrow('more than one step targets schema version 1')
  })
})
