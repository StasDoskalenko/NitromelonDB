import { useCallback, useRef } from 'react'
import type Model from '../Model'
import type Query from '../Query'
import type { ColumnName } from '../Schema'
import useStableArray from './useStableArray'
import useTick from './useTick'

/**
 * Subscribes to a query and returns its current matching records, re-rendering
 * whenever the matching set changes.
 *
 * ```js
 * function NotesList({ notes }) {
 *   const pinned = useQuery(notes.query(Q.where('pinned', true)))
 *   return pinned.map((note) => <NoteRow key={note.id} note={note} />)
 * }
 * ```
 *
 * Pass `columnNames` to also re-render when one of those fields changes on
 * any record already in the list (the query-level equivalent of
 * `query.observeWithColumns()`/`experimentalSubscribeWithColumns()`) — by
 * default, like `query.observe()`, only additions/removals from the
 * matching set are observed, not field-level changes within it.
 *
 * Unlike a record (see useRecord), each emission here is a genuinely new
 * array, so there's no reference-equality pitfall to work around — this
 * still goes through the same useTick mechanism as useRecord/useObservable
 * for consistency, not because it's required here.
 *
 * `query` may be `null`/`undefined` (e.g. while its inputs are still
 * loading); an empty array is returned and no subscription is set up.
 *
 * `columnNames` doesn't need to be memoized by the caller (e.g.
 * `useQuery(query, ['name'])` inline is fine) — it's compared by content,
 * not by reference, so passing a fresh array literal on every render won't
 * cause a resubscribe unless the columns actually changed.
 */
export default function useQuery<T extends Model>(
  query: Query<T> | null | undefined,
  columnNames?: ColumnName[],
): T[] {
  const recordsRef = useRef<T[]>([])
  if (!query) {
    recordsRef.current = []
  }

  const stableColumnNames = useStableArray(columnNames)

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!query) {
        return () => {}
      }
      const onRecords = (records: T[]) => {
        recordsRef.current = records
        notify()
      }
      return stableColumnNames
        ? query.experimentalSubscribeWithColumns(stableColumnNames, onRecords)
        : query.experimentalSubscribe(onRecords)
    },
    [query, stableColumnNames],
  )
  useTick(subscribe)

  return recordsRef.current
}
