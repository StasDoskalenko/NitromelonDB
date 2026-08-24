/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react'
import { Subject } from '../utils/rx'
import useObservable from './useObservable'
import { mockDatabase } from '../__tests__/testModels'

describe('useObservable', () => {
  it('returns the default value before the first emission, then live values', () => {
    const subject = new Subject()
    const { result } = renderHook(() => useObservable(subject, 'default'))

    expect(result.current).toBe('default')

    act(() => {
      subject.next('first')
    })
    expect(result.current).toBe('first')

    act(() => {
      subject.next('second')
    })
    expect(result.current).toBe('second')
  })

  it('returns defaultValue for null/undefined without subscribing', () => {
    const { result } = renderHook(({ observable }) => useObservable(observable, 'fallback'), {
      initialProps: { observable: null },
    })
    expect(result.current).toBe('fallback')
  })

  it('interops with this library\'s Rx-based .observe() (model)', async () => {
    const { database, tasks } = mockDatabase()
    const task = await database.write(() => tasks.create((t) => (t.name = 'A')))

    const { result } = renderHook(() => useObservable(task.observe(), task))

    expect(result.current.name).toBe('A')

    await act(async () => {
      await database.write(() => task.update((t) => (t.name = 'A renamed')))
    })

    expect(result.current).toBe(task)
    expect(result.current.name).toBe('A renamed')
  })
})
