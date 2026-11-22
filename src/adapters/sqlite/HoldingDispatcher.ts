import type { ResultCallback } from '../../utils/fp/Result'
import type { SqliteDispatcher, SqliteDispatcherMethod } from './type'

type HeldCall = [SqliteDispatcherMethod, unknown[], ResultCallback<unknown>]

// Used by SQLiteAdapter with the `encryption` option. Holds calls back, in order, while:
// - the passphrase is still being resolved (a function, e.g. the Keychain): there's no native
//   connection yet. setTarget() then sends them on, or fail() fails them all with the reason.
// - the encryption key is being changed on a native background thread: native calls would wait for
//   it anyway (the native mutex), but blocking the JS thread for seconds. hold() / release.
//
// Callbacks of held calls run later, not during call(). Nothing relies on synchronous answers for
// correctness (see SQLiteAdapter#_tablesToReindex, which only loses an optimization).
export default class HoldingDispatcher implements SqliteDispatcher {
  _target: SqliteDispatcher | null = null

  _error: Error | null = null

  _queue: HeldCall[] = []

  _holds: number = 0

  _flushing: boolean = false

  call<T>(methodName: SqliteDispatcherMethod, args: unknown[], callback: ResultCallback<T>): void {
    if (this._error) {
      callback({ error: this._error })
      return
    }
    // Behind anything already held, so calls never overtake each other. Except calls made from the
    // callback of a held call as it's sent (initialize -> setUpWithSchema): those go straight
    // through, as they would with a synchronous dispatcher, before the next held call
    if (!this._target || this._holds || (this._queue.length && !this._flushing)) {
      this._queue.push([methodName, args, callback as ResultCallback<unknown>])
      return
    }
    this._target.call(methodName, args, callback)
  }

  // Sends a call straight to the target, past any hold: the work done while holding
  callNow<T>(
    methodName: SqliteDispatcherMethod,
    args: unknown[],
    callback: ResultCallback<T>,
  ): void {
    if (this._error) {
      callback({ error: this._error })
      return
    }
    if (!this._target) {
      callback({ error: new Error(`Database isn't open yet, so ${methodName}() can't run now`) })
      return
    }
    this._target.call(methodName, args, callback)
  }

  setTarget(target: SqliteDispatcher): void {
    this._target = target
    this._flush()
  }

  // Every held call, and every later one, fails with `error`
  fail(error: Error): void {
    this._error = error
    const queue = this._queue
    this._queue = []
    queue.forEach(([, , callback]) => callback({ error }))
  }

  // Holds every call from now on until the returned function is called
  hold(): () => void {
    this._holds += 1
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      this._holds -= 1
      this._flush()
    }
  }

  _flush(): void {
    if (this._flushing) {
      return
    }
    this._flushing = true
    try {
      // A callback may make new calls (queued behind) or hold again (stops here)
      while (this._queue.length && this._target && !this._holds && !this._error) {
        const [methodName, args, callback] = this._queue.shift() as HeldCall
        this._target.call(methodName, args, callback)
      }
    } finally {
      this._flushing = false
    }
  }
}
