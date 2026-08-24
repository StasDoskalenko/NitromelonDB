import type { Unsubscribe } from '../type'
import invariant from '../../common/invariant'

// A subscribable that implements the equivalent of:
// multicast(() => new ReplaySubject(1)) |> refCount Rx operation
//
// In other words:
// - Upon subscription, the source subscribable is subscribed to,
//   and its notifications are passed to subscribers here.
// - Multiple subscribers only cause a single subscription of the source
// - When last subscriber unsubscribes, the source is unsubscribed
// - Upon subscription, the subscriber receives last value sent by source (if any)

type Subscriber<T> = (value: T) => void
type SubscriberEntry<T> = [Subscriber<T>, unknown]

export type SharedSubscribableOptions = {
  // Called once when the number of subscribers goes from 0 to 1 (not on every
  // individual subscribe) -- e.g. so an owner can track which of its
  // SharedSubscribables currently have someone listening.
  onActivate?: () => void
  // Called once when the number of subscribers goes from 1 to 0. Not called
  // by invalidate() below, since that doesn't change who's subscribed.
  onDeactivate?: () => void
}

export default class SharedSubscribable<T> {
  _source: (subscriber: Subscriber<T>) => Unsubscribe
  _unsubscribeSource: Unsubscribe | null | undefined = null
  _subscribers: SubscriberEntry<T>[] = []
  _lastEmission: { value: T } | null = null
  _onActivate: (() => void) | undefined
  _onDeactivate: (() => void) | undefined

  constructor(
    source: (subscriber: Subscriber<T>) => Unsubscribe,
    { onActivate, onDeactivate }: SharedSubscribableOptions = {},
  ) {
    this._source = source
    this._onActivate = onActivate
    this._onDeactivate = onDeactivate
  }

  subscribe(subscriber: Subscriber<T>, debugInfo?: unknown): Unsubscribe {
    const entry: SubscriberEntry<T> = [subscriber, debugInfo]
    this._subscribers.push(entry)

    if (this._lastEmission) {
      subscriber(this._lastEmission.value)
    }

    if (this._subscribers.length === 1) {
      this._subscribeToSource()
      this._onActivate?.()
    }

    return () => this._unsubscribe(entry)
  }

  _subscribeToSource(): void {
    // TODO: What if this throws?
    this._unsubscribeSource = this._source((value) => this._notify(value))
  }

  _notify(value: T): void {
    invariant(
      this._subscribers.length,
      `SharedSubscribable's source emitted a value after it was unsubscribed from`,
    )
    this._lastEmission = { value }
    this._subscribers.forEach(([subscriber]) => {
      subscriber(value)
    })
  }

  _unsubscribe(entry: SubscriberEntry<T>): void {
    const idx = this._subscribers.indexOf(entry)
    idx !== -1 && this._subscribers.splice(idx, 1)

    if (!this._subscribers.length) {
      const unsubscribe = this._unsubscribeSource
      this._unsubscribeSource = null
      this._lastEmission = null
      unsubscribe && unsubscribe()
      this._onDeactivate?.()
    }
  }

  /**
   * Forgets the last emitted value and, if there are currently active
   * subscribers, immediately re-subscribes to the source so they get a fresh
   * value instead of being stuck with a stale one.
   *
   * Intended for recovering from `Database#unsafeResetDatabase()`: per its
   * contract, no subscription should still be active when it's called, but
   * if one is (an app bug), its emissions would otherwise reflect
   * pre-reset/other-user data forever, since nothing else would tell it the
   * underlying data changed. Does not affect the subscriber list itself, so
   * `onActivate`/`onDeactivate` are not called.
   */
  invalidate(): void {
    if (this._unsubscribeSource) {
      this._unsubscribeSource()
      this._unsubscribeSource = null
    }
    this._lastEmission = null

    if (this._subscribers.length) {
      this._subscribeToSource()
    }
  }
}
