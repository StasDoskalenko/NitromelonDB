import type { Observable } from "../__wmelonRxShim";
import { defer } from "../__wmelonRxShim"; // Performs an action when Observable is subscribed to; analogous to `Observable.do`

export default function doOnSubscribe<T>(onSubscribe: () => void): (arg0: Observable<T>) => Observable<T> {
  return source => defer(() => {
    onSubscribe();
    return source;
  });
}
