/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react'
import useWriter from './useWriter'
import { mockDatabase } from '../__tests__/testModels'

describe('useWriter', () => {
  let database
  let tasks
  beforeEach(() => {
    ;({ database, tasks } = mockDatabase())
  })

  it('runs the writer inside database.write() and lets it mutate the record', async () => {
    const task = await database.write(() => tasks.create((t) => (t.name = 'A')))

    const { result } = renderHook(() =>
      useWriter(task, async (record, newName) => {
        await record.update((t) => {
          t.name = newName
        })
      }),
    )
    const [rename] = result.current

    await act(async () => {
      await rename('B')
    })

    expect(task.name).toBe('B')
  })

  it('passes extra arguments through to the writer, after the record', async () => {
    const task = await database.write(() => tasks.create())
    const writer = jest.fn()

    const { result } = renderHook(() => useWriter(task, writer))
    const [run] = result.current

    await act(async () => {
      await run('a', 'b', 3)
    })

    expect(writer).toHaveBeenCalledWith(task, 'a', 'b', 3)
  })

  it('tracks isPending across the write', async () => {
    const task = await database.write(() => tasks.create())
    let resolveWriter
    const writer = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveWriter = resolve
        }),
    )

    const { result } = renderHook(() => useWriter(task, writer))
    const [run] = result.current

    expect(result.current[1].isPending).toBe(false)

    let runPromise
    act(() => {
      runPromise = run()
    })
    expect(result.current[1].isPending).toBe(true)

    await act(async () => {
      resolveWriter()
      await runPromise
    })
    expect(result.current[1].isPending).toBe(false)
  })

  it('captures and re-throws errors, resetting isPending, and clears error on the next call', async () => {
    const task = await database.write(() => tasks.create())
    const error = new Error('boom')
    const writer = jest.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined)

    const { result } = renderHook(() => useWriter(task, writer))
    const [run] = result.current

    await act(async () => {
      await expect(run()).rejects.toBe(error)
    })
    expect(result.current[1].isPending).toBe(false)
    expect(result.current[1].error).toBe(error)

    await act(async () => {
      await run()
    })
    expect(result.current[1].error).toBe(undefined)
  })

  it('always runs the latest writer, without needing it to be memoized by the caller', async () => {
    const task = await database.write(() => tasks.create())
    const first = jest.fn()
    const second = jest.fn()

    const { result, rerender } = renderHook(({ writer }) => useWriter(task, writer), {
      initialProps: { writer: first },
    })

    rerender({ writer: second })
    const [run] = result.current

    await act(async () => {
      await run()
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('keeps the same callback identity across re-renders as long as the model is unchanged', () => {
    const model = tasks.prepareCreate()
    const { result, rerender } = renderHook(() => useWriter(model, jest.fn()))
    const [runBefore] = result.current

    rerender()
    const [runAfter] = result.current

    expect(runAfter).toBe(runBefore)
  })

  it('gets a new callback identity when the model changes', async () => {
    const [taskA, taskB] = await database.write(() =>
      Promise.all([tasks.create(), tasks.create()]),
    )

    const { result, rerender } = renderHook(({ model }) => useWriter(model, jest.fn()), {
      initialProps: { model: taskA },
    })
    const [runA] = result.current

    rerender({ model: taskB })
    const [runB] = result.current

    expect(runB).not.toBe(runA)
  })

  it('throws if model is null/undefined when called', async () => {
    const { result } = renderHook(() => useWriter(null, jest.fn()))
    const [run] = result.current

    await expect(run()).rejects.toThrow('cannot write, model is null/undefined')
  })
})
