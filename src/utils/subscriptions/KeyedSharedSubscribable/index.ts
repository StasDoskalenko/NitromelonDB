import SharedSubscribable, { type SharedSubscribableOptions } from '../SharedSubscribable'
import type { Unsubscribe } from '../type'

export type Subscriber<Value> = (value: Value) => void
export type Source<Value> = (subscriber: Subscriber<Value>) => Unsubscribe

/**
 * A family of {@link SharedSubscribable}s, one lazily created per distinct
 * key — for sources that are parameterized (e.g. "observe this query, but
 * only re-emit when one of *these* columns changes") where different
 * callers requesting logically the same parameters should still share one
 * underlying subscription, the same way `SharedSubscribable` already lets
 * multiple callers of the *same*, unparameterized source share one.
 *
 * This is this library's Rx-free take on what RxJS calls `shareReplay(1)`
 * (technically `multicast(() => new ReplaySubject(1)), refCount()` — see
 * {@link https://rxjs.dev/api/index/function/shareReplay} and
 * {@link https://rxjs.dev/api/operators/refCount}), generalized to a family
 * of shared sources instead of one, and built on `SharedSubscribable`
 * (this library's own equivalent of that RxJS operator, already used by
 * {@link Query#_cachedSubscribable}/`_cachedCountSubscribable`) rather than
 * an RxJS `Subject`.
 *
 * `keyOf` derives a cache key from a parameter value — two parameter values
 * that produce the same key are treated as "the same source" and share one
 * `SharedSubscribable`. `sourceFor` is called (once per distinct key, the
 * first time it's needed) to build the actual source for that key.
 *
 * @example
 * ```ts
 * const bySortColumn = new KeyedSharedSubscribable<ColumnName, Task[]>(
 *   (column) => column,
 *   (column) => (subscriber) => subscribeToTasksSortedBy(column, subscriber),
 * )
 * bySortColumn.subscribe('dueDate', (tasks) => { ... })
 * ```
 */
export default class KeyedSharedSubscribable<Key, Value> {
  _subscribables: Map<string, SharedSubscribable<Value>> = new Map()

  _keyOf: (key: Key) => string

  _sourceFor: (key: Key) => Source<Value>

  _onActivate: (() => void) | undefined

  _onDeactivate: (() => void) | undefined

  // Number of distinct keys that currently have at least one subscriber.
  // Drives onActivate/onDeactivate the same way SharedSubscribable's own
  // subscriber count drives its onActivate/onDeactivate, but aggregated
  // across the whole family, so a caller (e.g. Query) can tell whether *any*
  // of its keys are being observed without inspecting each one.
  _activeKeyCount: number = 0

  constructor(
    keyOf: (key: Key) => string,
    sourceFor: (key: Key) => Source<Value>,
    { onActivate, onDeactivate }: SharedSubscribableOptions = {},
  ) {
    this._keyOf = keyOf
    this._sourceFor = sourceFor
    this._onActivate = onActivate
    this._onDeactivate = onDeactivate
  }

  /**
   * Returns the `SharedSubscribable` for `key`, creating (and caching) it on
   * first access. Prefer {@link KeyedSharedSubscribable#subscribe} unless you
   * need the `SharedSubscribable` itself (e.g. to check `_lastEmission`).
   */
  get(key: Key): SharedSubscribable<Value> {
    const cacheKey = this._keyOf(key)
    const existing = this._subscribables.get(cacheKey)
    if (existing) {
      return existing
    }

    const subscribable = new SharedSubscribable(this._sourceFor(key), {
      onActivate: () => {
        this._activeKeyCount += 1
        if (this._activeKeyCount === 1) {
          this._onActivate?.()
        }
      },
      onDeactivate: () => {
        this._activeKeyCount -= 1
        if (this._activeKeyCount === 0) {
          this._onDeactivate?.()
        }
      },
    })
    this._subscribables.set(cacheKey, subscribable)
    return subscribable
  }

  subscribe(key: Key, subscriber: Subscriber<Value>): Unsubscribe {
    return this.get(key).subscribe(subscriber)
  }

  /**
   * Invalidates every currently-cached `SharedSubscribable` in the family —
   * see {@link SharedSubscribable#invalidate}. Used to recover from
   * `Database#unsafeResetDatabase()` when a subscription (against its
   * contract) survived the reset.
   */
  invalidate(): void {
    this._subscribables.forEach((subscribable) => subscribable.invalidate())
  }
}
