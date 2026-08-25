import { useEffect, useState } from 'react'
import type Database from '../Database'

/**
 * `true` once `database`'s schema setup/migrations and any pending `seed` steps have settled
 * (see `DatabaseProps#seed`, `Database#readyPromise`) -- `false` before that, and while
 * `database` itself is `null`/`undefined`.
 *
 * Reading/writing through `database` is already safe before this becomes `true` -- every
 * write()/read()/batch() call and every direct Collection/Query read queues correctly on its own
 * (see `DatabaseProps#seed`). This hook exists for when you want to gate your own UI on
 * readiness explicitly instead, e.g. a splash screen:
 *
 * ```js
 * function App({ database }) {
 *   const ready = useDatabaseReady(database)
 *   if (!ready) {
 *     return <LoadingScreen />
 *   }
 *   return <Main database={database} />
 * }
 * ```
 */
export default function useDatabaseReady(database: Database | null | undefined): boolean {
  const [ready, setReady] = useState(() => database?.isReady ?? false)

  useEffect(() => {
    if (!database) {
      setReady(false)
      return
    }
    if (database.isReady) {
      setReady(true)
      return
    }
    setReady(false)
    // Guards against both unmount AND `database` itself changing again before this particular
    // readyPromise settles -- either way, this specific effect run is stale by the time the
    // promise resolves, and must not set state for a database that's no longer the current one
    // (or a component that's no longer mounted).
    let stale = false
    database.readyPromise.then(() => {
      if (!stale) {
        setReady(true)
      }
    })
    return () => {
      stale = true
    }
  }, [database])

  return ready
}
