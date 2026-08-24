import { useCallback, useRef } from 'react'
import type { Observable } from '../utils/rx'
import useTick from './useTick'

/**
 * Generic escape hatch for any RxJS Observable — your own, or one built from
 * this library's `.observe()` methods (`model.observe()`, `query.observe()`,
 * `query.observeCount()`, ...), including ones composed with `switchMap`,
 * `combineLatest`, and the like.
 *
 * ```js
 * const isEmpty = useObservable(notes.query().observeCount().pipe(map((n) => n === 0)), true)
 * ```
 *
 * For plain records or queries, prefer useModel/useQuery — they're built on
 * this library's Rx-free `experimentalSubscribe*` methods (no RxJS
 * dependency pulled into your bundle just to observe one record or list),
 * and useQuery gives you column-level observation as a plain parameter
 * instead of a `.pipe()` composition.
 *
 * `defaultValue` is returned until the observable's first emission, and
 * whenever `observable` is `null`/`undefined`.
 */
export default function useObservable<T>(
  observable: Observable<T> | null | undefined,
  defaultValue: T,
): T {
  const valueRef = useRef<T>(defaultValue)
  if (!observable) {
    valueRef.current = defaultValue
  }

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!observable) {
        return () => {}
      }
      const subscription = observable.subscribe((value) => {
        valueRef.current = value
        notify()
      })
      return () => subscription.unsubscribe()
    },
    [observable],
  )
  useTick(subscribe)

  return valueRef.current
}
