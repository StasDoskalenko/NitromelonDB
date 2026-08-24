import SharedSubscribable from '../SharedSubscribable'
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

  constructor(keyOf: (key: Key) => string, sourceFor: (key: Key) => Source<Value>) {
    this._keyOf = keyOf
    this._sourceFor = sourceFor
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

    const subscribable = new SharedSubscribable(this._sourceFor(key))
    this._subscribables.set(cacheKey, subscribable)
    return subscribable
  }

  subscribe(key: Key, subscriber: Subscriber<Value>): Unsubscribe {
    return this.get(key).subscribe(subscriber)
  }
}
