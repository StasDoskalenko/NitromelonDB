import { useRef } from 'react'
import identicalArrays from '../utils/fp/identicalArrays'

/**
 * Returns the same array reference across renders as long as its *contents*
 * haven't changed — so it's safe to put in a `useCallback`/`useEffect`
 * dependency array even when the caller passes a fresh array literal on
 * every render (e.g. `useQuery(query, ['name'])`), without resubscribing on
 * every render just because that literal is a new object each time.
 */
export default function useStableArray<T>(array: T[] | undefined): T[] | undefined {
  const ref = useRef(array)
  if (array === undefined || ref.current === undefined || !identicalArrays(ref.current, array)) {
    ref.current = array
  }
  return ref.current
}
