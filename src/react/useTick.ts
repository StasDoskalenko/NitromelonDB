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
 * `subscribe` is invoked by React to establish/re-establish the
 * subscription (whenever `deps` change, or in StrictMode's double-invoke);
 * call the `notify` callback it's given every time the source has changed.
 */
export default function useTick(
  subscribe: (notify: () => void) => () => void,
  deps: readonly unknown[],
): void {
  const tickRef = useRef(0)

  /* eslint-disable react-hooks/exhaustive-deps -- `deps` is this hook's own
   * parameter, forwarded verbatim from the caller (useModel/useQuery/
   * useObservable), not a literal eslint can statically check here. */
  const subscribeStore = useCallback((onStoreChange: () => void) => {
    return subscribe(() => {
      tickRef.current += 1
      onStoreChange()
    })
  }, deps)

  const getSnapshot = useCallback(() => tickRef.current, deps)
  /* eslint-enable react-hooks/exhaustive-deps */

  useSyncExternalStore(subscribeStore, getSnapshot)
}
