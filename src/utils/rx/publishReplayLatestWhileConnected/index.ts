import type { ConnectableObservable, Observable } from '../__wmelonRxShim'
import { ReplaySubject, multicast } from '../__wmelonRxShim'

// Creates a Connectable observable, that, while connected, replays the latest emission
// upon subscription. When disconnected, the replay cache is cleared.

export default function publishReplayLatestWhileConnected<T>(
  source: Observable<T>,
): ConnectableObservable<T> {
  return source.pipe(multicast(() => new ReplaySubject<T>(1))) as ConnectableObservable<T>
}
