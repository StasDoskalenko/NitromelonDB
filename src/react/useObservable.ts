import { useCallback, useRef } from 'react'
import type { Observable } from '../utils/rx'
import useTick from './useTick'

export type UseObservableStatus = {
  /** Whether the observable has emitted at least one value so far. */
  hasEmitted: boolean
  /**
   * Set if the observable errored (RxJS observables terminate on error, so
   * this stays set until `observable` itself changes). `value` keeps
   * whatever was last emitted before the error, if anything.
   */
  error: unknown
}

/**
 * Generic escape hatch for any RxJS Observable — your own, or one built from
 * this library's `.observe()` methods (`model.observe()`, `query.observe()`,
 * `query.observeCount()`, ...), including ones composed with `switchMap`,
 * `combineLatest`, and the like.
 *
 * ```js
 * const [isEmpty, { hasEmitted, error }] = useObservable(
 *   notes.query().observeCount().pipe(map((n) => n === 0)),
 *   true,
 * )
 * ```
 *
 * For plain records or queries, prefer useModel/useQuery — they're built on
 * this library's Rx-free `experimentalSubscribe*` methods (no RxJS
 * dependency pulled into your bundle just to observe one record or list),
 * and useQuery gives you column-level observation as a plain parameter
 * instead of a `.pipe()` composition. Unlike those, an arbitrary Observable
 * genuinely can take a while to emit (network-derived, debounced, ...) or
 * error outright, which is why this one reports `hasEmitted`/`error`
 * instead of just handing back a value.
 *
 * `defaultValue` is returned (with `hasEmitted: false`) until the
 * observable's first emission, and whenever `observable` is
 * `null`/`undefined`.
 */
export default function useObservable<T>(
  observable: Observable<T> | null | undefined,
  defaultValue: T,
): [T, UseObservableStatus] {
  const valueRef = useRef<T>(defaultValue)
  const hasEmittedRef = useRef(false)
  const errorRef = useRef<unknown>(undefined)

  if (!observable) {
    valueRef.current = defaultValue
    hasEmittedRef.current = false
    errorRef.current = undefined
  }

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!observable) {
        return () => {}
      }
      const subscription = observable.subscribe({
        next: (value) => {
          valueRef.current = value
          hasEmittedRef.current = true
          errorRef.current = undefined
          notify()
        },
        error: (error: unknown) => {
          errorRef.current = error
          notify()
        },
      })
      return () => subscription.unsubscribe()
    },
    [observable],
  )
  useTick(subscribe)

  return [valueRef.current, { hasEmitted: hasEmittedRef.current, error: errorRef.current }]
}
