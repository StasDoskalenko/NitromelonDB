import { useMemo } from 'react'
import { Q } from 'nitromelondb'
import { useObservable, useQuery } from 'nitromelondb/hooks'
import type { ExampleDatabase } from '../database'
import type Note from '../model/Note'

// Seeding (see database.ts's `seed` option) is queued ahead of every read/write issued after the
// database is constructed, including the subscriptions below -- so there's no seed-vs-subscribe
// race to guard against here. A brief count of 0 is still possible on first launch while seeding
// is in flight; it settles to 100 once seeding completes.
export function useNotes(
  session: ExampleDatabase,
  page: number,
  pageSize: number,
): { notes: Note[]; totalCount: number } {
  const listQuery = useMemo(
    () =>
      session.notes.query(
        Q.sortBy('pinned', Q.desc),
        Q.sortBy('rank', Q.asc),
        Q.skip((page - 1) * pageSize),
        Q.take(pageSize),
      ),
    [session, page, pageSize],
  )
  // A separate, unpaginated query -- observeCount() only reports how many rows match, not which
  // page they're on, so it doesn't need (or want) the skip/take above.
  const countObservable = useMemo(() => session.notes.query().observeCount(), [session])

  const notes = useQuery(listQuery, ['title', 'body', 'pinned', 'rank'])
  const [totalCount] = useObservable(countObservable, 0)

  return { notes, totalCount }
}
