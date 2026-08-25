/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react'
import useDatabaseReady from './useDatabaseReady'
import { mockDatabase } from '../__tests__/testModels'
import { databaseSeed } from '../Database/seed'

// run() is only invoked after an async version-check (adapter.getLocal()) resolves, not
// synchronously during construction -- so `resolveRun` isn't safe to call until `runStarted`
// resolves, confirming run() has actually been invoked (and so assigned it).
function pendingSeedStep(schemaVersion = 1) {
  let resolveRun
  let runStarted
  const runStartedPromise = new Promise((resolve) => {
    runStarted = resolve
  })
  const seed = databaseSeed({
    steps: [
      {
        schemaVersion,
        run: () => {
          runStarted()
          return new Promise((resolve) => {
            resolveRun = resolve
          })
        },
      },
    ],
  })
  return { seed, runStartedPromise, resolveRun: () => resolveRun() }
}

describe('useDatabaseReady', () => {
  it('returns true immediately when the database has no pending seed', () => {
    const { database } = mockDatabase()

    const { result } = renderHook(() => useDatabaseReady(database))

    expect(result.current).toBe(true)
  })

  it('returns false while a seed step is pending, then true once it resolves', async () => {
    const { seed, runStartedPromise, resolveRun } = pendingSeedStep()
    const { database } = mockDatabase({ seed })

    const { result } = renderHook(() => useDatabaseReady(database))
    expect(result.current).toBe(false)

    await runStartedPromise
    await act(async () => {
      resolveRun()
      await database.readyPromise
    })

    expect(result.current).toBe(true)
  })

  it('returns false when database is null/undefined', () => {
    const { result } = renderHook(() => useDatabaseReady(null))
    expect(result.current).toBe(false)
  })

  it('re-evaluates when database changes from not-ready to a different, ready instance', async () => {
    const { seed, runStartedPromise, resolveRun } = pendingSeedStep()
    const { database: notReadyDb } = mockDatabase({ seed })
    const { database: readyDb } = mockDatabase()

    const { result, rerender } = renderHook(({ database }) => useDatabaseReady(database), {
      initialProps: { database: notReadyDb },
    })
    expect(result.current).toBe(false)

    rerender({ database: readyDb })
    expect(result.current).toBe(true)

    // cleans up the still-pending seed's eventual resolution without touching state for the
    // no-longer-used database instance
    await runStartedPromise
    resolveRun()
    await notReadyDb.readyPromise
  })

  it('does not update state after unmount', async () => {
    const { seed, runStartedPromise, resolveRun } = pendingSeedStep()
    const { database } = mockDatabase({ seed })

    const { unmount } = renderHook(() => useDatabaseReady(database))
    unmount()

    // resolving after unmount must not throw/warn about setting state on an unmounted component
    await runStartedPromise
    await act(async () => {
      resolveRun()
      await database.readyPromise
    })
  })
})
