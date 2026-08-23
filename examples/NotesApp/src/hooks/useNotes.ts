import { useEffect, useState } from 'react'
import { Q } from 'nitromelondb'
import { SEEDED_KEY } from '../constants'
import type { ExampleDatabase } from '../database'
import type Note from '../model/Note'

export function useNotes(
  session: ExampleDatabase,
  page: number,
  pageSize: number,
  listRevision: number = 0,
): { notes: Note[]; totalCount: number; error: string | null } {
  const [notes, setNotes] = useState<Note[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const unsubscribeCount = session.notes.query().experimentalSubscribeToCount((count) => {
      if (!cancelled) {
        setTotalCount(count)
      }
    })

    const seed = async () => {
      try {
        const seeded = await session.database.localStorage.get<boolean>(SEEDED_KEY)
        if (seeded) {
          const count = await session.notes.query().fetchCount()
          if (count > 0) {
            return
          }
        }
        await session.database.write(async () => {
          await session.notes.query().destroyAllPermanently()
          for (let i = 0; i < 100; i++) {
            await session.notes.create((note) => {
              note.title = `Note #${i + 1}`
              note.body = `This is note number ${i + 1}.`
              note.createdAt = new Date(Date.now() - (100 - i) * 60_000)
              note.sortOrder = i + 1
              note.pinned = false
            })
          }
        })
        await session.database.localStorage.set(SEEDED_KEY, true)
      } catch (seedError) {
        if (!cancelled) {
          setError(seedError instanceof Error ? seedError.message : String(seedError))
        }
      }
    }

    void seed()
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
        Q.sortBy('sort_order', Q.desc),
        Q.skip((page - 1) * pageSize),
        Q.take(pageSize),
      )
      .experimentalSubscribeWithColumns(['title', 'body', 'pinned', 'sort_order'], (next) => {
        if (!cancelled) {
          setNotes(next)
        }
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [session, page, pageSize, listRevision])

  return { notes, totalCount, error }
}
