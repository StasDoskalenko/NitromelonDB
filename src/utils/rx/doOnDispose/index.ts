import { Observable } from '../__wmelonRxShim'
import type { Observer } from 'rxjs'

// Performs an action when Observable is disposed; analogous to `Observable.do`
export default function doOnDispose<T>(
  onDispose: () => void,
): (source: Observable<T>) => Observable<T> {
  return (source) =>
    new Observable<T>((observer: Observer<T>) => {
      const subscription = source.subscribe(observer)
      return () => {
        subscription.unsubscribe()
        onDispose()
      }
    })
}
