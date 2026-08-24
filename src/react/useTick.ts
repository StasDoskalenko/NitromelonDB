import { useCallback, useRef, useSyncExternalStore } from 'react'

/**
 * Shared low-level primitive behind useModel/useQuery/useObservable.
 *
 * Records (and this library's other observable sources) notify subscribers
 * on change, but don't necessarily hand you a new value each time — a
 * record is mutated in place and `experimentalSubscribe` just says "this
 * changed," so there's nothing here to compare by reference. Relying on
 * React state (`useState`/`useSyncExternalStore`'s own snapshot comparison)
 * to detect "did it change" would silently stop re-rendering the moment
 * the same object reference comes back twice — which, for a record, is
 * every single time.
 *
 * `useTick` sidesteps that the same way this library's `withObservables`
 * already does under the hood (a class component whose
 * `shouldComponentUpdate` doesn't check value identity, only a fetching
 * flag) — it forces a re-render on every notification via a counter that's
 * guaranteed to differ from the last one, instead of trying to diff the
 * actual data. Callers read whatever they need (a mutated-in-place record,
 * a ref holding the latest emitted array, ...) during the render that
 * triggers.
 *
 * `subscribe` must already be a stable, correctly-memoized callback (a
 * `useCallback` in the caller, with a real, lint-checked dependency array)
 * — this hook doesn't take a `deps` array of its own to forward it with, on
 * purpose: that would mean trusting that `deps` fully covers whatever
 * `subscribe` closes over, with nothing (not even
 * `react-hooks/exhaustive-deps`) left to verify it. Requiring an
 * already-memoized function instead pushes that correctness requirement
 * back to each caller's own `useCallback`, where the lint rule can actually
 * check it. React re-establishes the subscription (unsubscribe + subscribe)
 * whenever `subscribe` itself changes identity, or in StrictMode's
 * double-invoke.
 */
export default function useTick(subscribe: (notify: () => void) => () => void): void {
  const tickRef = useRef(0)

  const subscribeStore = useCallback(
    (onStoreChange: () => void) =>
      subscribe(() => {
        tickRef.current += 1
        onStoreChange()
      }),
    [subscribe],
  )

  const getSnapshot = useCallback(() => tickRef.current, [])

  useSyncExternalStore(subscribeStore, getSnapshot)
}
