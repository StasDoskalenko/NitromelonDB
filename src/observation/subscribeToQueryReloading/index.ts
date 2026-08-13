import { logError } from '../../utils/common'
import identicalArrays from '../../utils/fp/identicalArrays'
import { type Unsubscribe } from '../../utils/subscriptions'

import type Query from '../../Query'
import type Model from '../../Model'

// Produces an observable version of a query by re-querying the database
// when any change occurs in any of the relevant Stores.
// This is inefficient for simple queries, but necessary for complex queries

export default function subscribeToQueryReloading<Record extends Model>(
  query: Query<Record>,
  subscriber: (records: Record[]) => void,
  // Emits `false` when query fetch begins + always emits even if no change - internal trick needed
  // by observeWithColumns
  shouldEmitStatus: boolean = false,
): Unsubscribe {
  const { collection } = query
  let previousRecords: Record[] | null = null
  let unsubscribed = false
  const emit = subscriber as (records: Record[] | false) => void

  function reloadingObserverFetch(): void {
    if (shouldEmitStatus) {
      !unsubscribed && emit(false)
    }

    collection._fetchQuery(query, (result) => {
      if (result.error) {
        logError(result.error.toString())
        return
      }

      const records = result.value
      const shouldEmit =
        !unsubscribed &&
        (shouldEmitStatus || !previousRecords || !identicalArrays(records, previousRecords))
      previousRecords = records
      shouldEmit && emit(records)
    })
  }

  const unsubscribe = collection.database.experimentalSubscribe(
    query.allTables,
    reloadingObserverFetch,
    { name: 'subscribeToQueryReloading observation', query, subscriber },
  )
  reloadingObserverFetch()

  return () => {
    unsubscribed = true
    unsubscribe()
  }
}
