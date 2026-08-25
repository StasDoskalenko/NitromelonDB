import { useEffect, useState } from 'react'
import { Q } from 'nitromelondb'
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
  const [notes, setNotes] = useState<Note[]>([])
  const [totalCount, setTotalCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const unsubscribeCount = session.notes.query().experimentalSubscribeToCount((count) => {
      if (!cancelled) {
        setTotalCount(count)
      }
    })

    return () => {
      cancelled = true
      unsubscribeCount()
    }
  }, [session])

  useEffect(() => {
    let cancelled = false
    const unsubscribe = session.notes
      .query(
        Q.sortBy('pinned', Q.desc),
        Q.sortBy('rank', Q.asc),
        Q.skip((page - 1) * pageSize),
        Q.take(pageSize),
      )
      .experimentalSubscribeWithColumns(['title', 'body', 'pinned', 'rank'], (next) => {
        if (!cancelled) {
          setNotes(next)
        }
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [session, page, pageSize])

  return { notes, totalCount }
}
