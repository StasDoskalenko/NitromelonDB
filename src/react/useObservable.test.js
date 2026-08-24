/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react'
import { Subject } from '../utils/rx'
import useObservable from './useObservable'
import { mockDatabase } from '../__tests__/testModels'

describe('useObservable', () => {
  it('returns the default value and hasEmitted: false before the first emission, then live values', () => {
    const subject = new Subject()
    const { result } = renderHook(() => useObservable(subject, 'default'))

    expect(result.current[0]).toBe('default')
    expect(result.current[1]).toEqual({ hasEmitted: false, error: undefined })

    act(() => {
      subject.next('first')
    })
    expect(result.current[0]).toBe('first')
    expect(result.current[1]).toEqual({ hasEmitted: true, error: undefined })

    act(() => {
      subject.next('second')
    })
    expect(result.current[0]).toBe('second')
    expect(result.current[1]).toEqual({ hasEmitted: true, error: undefined })
  })

  it('returns defaultValue and hasEmitted: false for null/undefined without subscribing', () => {
    const { result } = renderHook(({ observable }) => useObservable(observable, 'fallback'), {
      initialProps: { observable: null },
    })
    expect(result.current[0]).toBe('fallback')
    expect(result.current[1]).toEqual({ hasEmitted: false, error: undefined })
  })

  it('reports an error the observable emits, keeping the last good value', () => {
    const subject = new Subject()
    const { result } = renderHook(() => useObservable(subject, 'default'))

    act(() => {
      subject.next('first')
    })
    expect(result.current[0]).toBe('first')

    const error = new Error('boom')
    act(() => {
      subject.error(error)
    })
    expect(result.current[0]).toBe('first')
    expect(result.current[1]).toEqual({ hasEmitted: true, error })
  })

  it('interops with this library\'s Rx-based .observe() (model)', async () => {
    const { database, tasks } = mockDatabase()
    const task = await database.write(() => tasks.create((t) => (t.name = 'A')))

    const { result } = renderHook(() => useObservable(task.observe(), task))

    expect(result.current[0].name).toBe('A')

    await act(async () => {
      await database.write(() => task.update((t) => (t.name = 'A renamed')))
    })

    expect(result.current[0]).toBe(task)
    expect(result.current[0].name).toBe('A renamed')
  })
})
