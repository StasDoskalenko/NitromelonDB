/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react'
import useAtomicWriter from './useAtomicWriter'
import { mockDatabase } from '../__tests__/testModels'

describe('useAtomicWriter', () => {
  let database
  let tasks
  beforeEach(() => {
    ;({ database, tasks } = mockDatabase())
  })

  it('updates the record when one is passed in', async () => {
    const task = await database.write(() => tasks.create((t) => (t.name = 'A')))

    const { result } = renderHook(() =>
      useAtomicWriter(tasks, task, (t) => {
        t.name = 'B'
      }),
    )
    const [run] = result.current

    let updated
    await act(async () => {
      updated = await run()
    })

    expect(updated).toBe(task)
    expect(task.name).toBe('B')
  })

  it('creates a new record in the collection when no record is passed in', async () => {
    const { result } = renderHook(() =>
      useAtomicWriter(tasks, undefined, (t) => {
        t.name = 'New task'
      }),
    )
    const [run] = result.current

    let created
    await act(async () => {
      created = await run()
    })

    expect(created.name).toBe('New task')
    expect(await tasks.find(created.id)).toBe(created)
  })

  it('also creates when record is null', async () => {
    const { result } = renderHook(() => useAtomicWriter(tasks, null, (t) => (t.name = 'X')))
    const [run] = result.current

    let created
    await act(async () => {
      created = await run()
    })

    expect(created.name).toBe('X')
  })

  it('tracks isPending/error the same way useWriter does', async () => {
    const task = await database.write(() => tasks.create())
    const error = new Error('boom')

    const { result, rerender } = renderHook(
      ({ builder }) => useAtomicWriter(tasks, task, builder),
      { initialProps: { builder: () => {} } },
    )

    rerender({
      builder: () => {
        throw error
      },
    })
    const [run] = result.current

    await act(async () => {
      await expect(run()).rejects.toBe(error)
    })

    expect(result.current[1].isPending).toBe(false)
    expect(result.current[1].error).toBe(error)
  })

  it('rejects if the builder is async -- atomic means synchronous, enforced by the same rule .update()/.create() already have', async () => {
    const task = await database.write(() => tasks.create())

    const { result } = renderHook(() =>
      useAtomicWriter(tasks, task, async (t) => {
        t.name = 'x'
      }),
    )
    const [run] = result.current

    // .update()/.create() already reject an async builder (via ensureSync)
    // before it's ever prepared/batched -- useAtomicWriter doesn't add this
    // check itself, it just doesn't get in the way of it
    await act(async () => {
      await expect(run()).rejects.toThrow('Unexpected Promise')
    })
    expect(result.current[1].error).toBeInstanceOf(Error)
  })

  it('does not require the builder to be memoized -- the latest one always runs', async () => {
    const task = await database.write(() => tasks.create())

    const { result, rerender } = renderHook(
      ({ builder }) => useAtomicWriter(tasks, task, builder),
      { initialProps: { builder: (t) => (t.name = 'first') } },
    )

    rerender({ builder: (t) => (t.name = 'second') })
    const [run] = result.current

    await act(async () => {
      await run()
    })

    expect(task.name).toBe('second')
  })

  it('keeps the same callback identity when collection/record are unchanged, and gets a new one when record changes', async () => {
    const [taskA, taskB] = await database.write(() =>
      Promise.all([tasks.create(), tasks.create()]),
    )

    const { result, rerender } = renderHook(({ task }) => useAtomicWriter(tasks, task, () => {}), {
      initialProps: { task: taskA },
    })
    const [runBefore] = result.current

    rerender({ task: taskA })
    expect(result.current[0]).toBe(runBefore)

    rerender({ task: taskB })
    expect(result.current[0]).not.toBe(runBefore)
  })

  it('does not touch isPending/error after unmount, but still lets the write complete', async () => {
    const task = await database.write(() => tasks.create((t) => (t.name = 'A')))

    // builder itself must stay synchronous (that's the whole point of
    // "atomic"), so to control timing for this test we delay database.write
    // itself instead
    const originalWrite = database.write.bind(database)
    let resolveWrite
    jest.spyOn(database, 'write').mockImplementation(
      (work) =>
        new Promise((resolve) => {
          resolveWrite = () => originalWrite(work).then(resolve)
        }),
    )

    const { result, unmount } = renderHook(() =>
      useAtomicWriter(tasks, task, (t) => {
        t.name = 'B'
      }),
    )
    const [run] = result.current

    let runPromise
    act(() => {
      runPromise = run()
    })
    expect(result.current[1].isPending).toBe(true)

    unmount()

    await act(async () => {
      resolveWrite()
      await runPromise
    })

    // the actual write still went through -- only the React state tracking
    // was skipped, not the write itself (and no warning/crash for setting
    // state after unmount, which is the main thing this test checks)
    expect(task.name).toBe('B')
  })
})
