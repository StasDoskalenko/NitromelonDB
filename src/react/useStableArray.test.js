/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react'
import useStableArray from './useStableArray'

describe('useStableArray', () => {
  it('returns the same reference across renders when contents are unchanged', () => {
    const { result, rerender } = renderHook(({ array }) => useStableArray(array), {
      initialProps: { array: ['a', 'b'] },
    })
    const first = result.current

    // A fresh array literal with the same contents, like a caller passing
    // `useQuery(query, ['a', 'b'])` inline on every render.
    rerender({ array: ['a', 'b'] })
    expect(result.current).toBe(first)

    rerender({ array: ['a', 'b'] })
    expect(result.current).toBe(first)
  })

  it('returns a new reference when contents actually change', () => {
    const { result, rerender } = renderHook(({ array }) => useStableArray(array), {
      initialProps: { array: ['a', 'b'] },
    })
    const first = result.current

    rerender({ array: ['a', 'c'] })
    expect(result.current).not.toBe(first)
    expect(result.current).toEqual(['a', 'c'])

    rerender({ array: ['a'] })
    expect(result.current).toEqual(['a'])
  })

  it('passes undefined through without throwing', () => {
    const { result, rerender } = renderHook(({ array }) => useStableArray(array), {
      initialProps: { array: undefined },
    })
    expect(result.current).toBe(undefined)

    rerender({ array: ['a'] })
    expect(result.current).toEqual(['a'])

    rerender({ array: undefined })
    expect(result.current).toBe(undefined)
  })
})
