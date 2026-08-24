import { useRef } from 'react'
import type Model from '../Model'
import type Query from '../Query'
import type { ColumnName } from '../Schema'
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
 * Unlike a record (see useModel), each emission here is a genuinely new
 * array, so there's no reference-equality pitfall to work around — this
 * still goes through the same useTick mechanism as useModel/useObservable
 * for consistency, not because it's required here.
 *
 * `query` may be `null`/`undefined` (e.g. while its inputs are still
 * loading); an empty array is returned and no subscription is set up.
 */
export default function useQuery<T extends Model>(
  query: Query<T> | null | undefined,
  columnNames?: ColumnName[],
): T[] {
  const recordsRef = useRef<T[]>([])
  if (!query) {
    recordsRef.current = []
  }

  useTick(
    (notify) => {
      if (!query) {
        return () => {}
      }
      const onRecords = (records: T[]) => {
        recordsRef.current = records
        notify()
      }
      return columnNames
        ? query.experimentalSubscribeWithColumns(columnNames, onRecords)
        : query.experimentalSubscribe(onRecords)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, columnNames && columnNames.join(',')],
  )

  return recordsRef.current
}
