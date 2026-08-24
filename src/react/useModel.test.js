/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react'
import useModel from './useModel'
import { mockDatabase } from '../__tests__/testModels'

describe('useModel', () => {
  let database
  let tasks
  beforeEach(() => {
    ;({ database, tasks } = mockDatabase())
  })

  it('re-renders on change and returns the same record (no cloning)', async () => {
    const task = await database.write(() => tasks.create((t) => (t.name = 'Buy milk')))

    const { result, rerender } = renderHook(({ record }) => useModel(record), {
      initialProps: { record: task },
    })

    expect(result.current).toBe(task)
    expect(result.current.name).toBe('Buy milk')

    await act(async () => {
      await database.write(() => task.update((t) => (t.name = 'Buy oat milk')))
    })

    // Same instance — useModel never clones — but the field read now reflects
    // the update, and the hook re-rendered to make sure we saw it.
    expect(result.current).toBe(task)
    expect(result.current.name).toBe('Buy oat milk')

    rerender({ record: task })
    expect(result.current.name).toBe('Buy oat milk')
  })

  it('re-renders on deletion, keeping the last known record', async () => {
    const task = await database.write(() => tasks.create((t) => (t.name = 'Buy milk')))
    const { result } = renderHook(() => useModel(task))

    await act(async () => {
      await database.write(() => task.destroyPermanently())
    })

    expect(result.current).toBe(task)
  })

  it('passes through null/undefined without subscribing', () => {
    const { result } = renderHook(({ record }) => useModel(record), {
      initialProps: { record: null },
    })
    expect(result.current).toBe(null)
  })

  it('re-subscribes when switching to a different record', async () => {
    const [taskA, taskB] = await database.write(() =>
      Promise.all([
        tasks.create((t) => (t.name = 'A')),
        tasks.create((t) => (t.name = 'B')),
      ]),
    )

    const { result, rerender } = renderHook(({ record }) => useModel(record), {
      initialProps: { record: taskA },
    })
    expect(result.current).toBe(taskA)

    rerender({ record: taskB })
    expect(result.current).toBe(taskB)

    // Updating taskA now must NOT affect a hook that's watching taskB.
    await act(async () => {
      await database.write(() => taskA.update((t) => (t.name = 'A changed')))
    })
    expect(result.current).toBe(taskB)
    expect(result.current.name).toBe('B')

    await act(async () => {
      await database.write(() => taskB.update((t) => (t.name = 'B changed')))
    })
    expect(result.current.name).toBe('B changed')
  })
})
