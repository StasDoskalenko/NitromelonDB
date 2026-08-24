import { useCallback, useEffect, useRef, useState } from 'react'
import { noop } from '../utils/fp'
import type Model from '../Model'
import type Collection from '../Collection'
import type { UseWriterStatus } from './useWriter'

/**
 * The narrower sibling of `useWriter`: no arbitrary writer function, just a
 * field-setting `builder` — the same kind you already pass to
 * `.create()`/`.update()` directly. There's a single rule for which one
 * runs: **pass a `record`, and it updates it; leave `record` out (or pass
 * `null`/`undefined`), and it creates a new one in `collection` instead.**
 *
 * `collection` is always required (it's where a new record would be
 * created) — get it with `database.get(Task)`, same as anywhere else.
 *
 * ```js
 * import Task from '../models/Task'
 *
 * // update: editing an existing task -- `task` is passed in, so this
 * // always updates it, never creates a new one
 * function useToggleDone(task) {
 *   return useAtomicWriter(task.database.get(Task), task, (task) => {
 *     task.isDone = !task.isDone
 *   })
 * }
 *
 * // create: no record passed in, so this always creates a new one
 * function useAddTask(database) {
 *   const [title, setTitle] = useState('')
 *   const [addTask, status] = useAtomicWriter(database.get(Task), undefined, (task) => {
 *     task.title = title
 *   })
 *   return [addTask, status]
 * }
 *
 * // both at once: the same hook backs a "new task" screen and an "edit
 * // task" screen, just depending on whether `task` was passed in
 * function useSaveTask(database, task, title) {
 *   return useAtomicWriter(database.get(Task), task, (task) => {
 *     task.title = title
 *   })
 * }
 * ```
 *
 * `builder` runs inside `.update()`/`.create()`, exactly like it would if
 * you called those yourself — including their existing rule that it must be
 * synchronous (no `async`, no `await` inside it). That's what "atomic"
 * means here: unlike `useWriter`'s free-form `writer`, there's no room for
 * unrelated/slow logic to end up inside the Writer (which would stall every
 * other write in the app for as long as it took to finish, since Writers
 * are exclusive) — there's nothing here *but* field assignments.
 *
 * Returns `[run, { isPending, error }]`, tracked the same way as
 * `useWriter` — see its docs for the full rundown (stable callback, no
 * memoization of `builder` required, unmount-safe). `run()` resolves to the
 * affected record: the same `record` you passed in (updated in place), or
 * the newly created one.
 */
export default function useAtomicWriter<T extends Model>(
  collection: Collection<T>,
  record: T | null | undefined,
  builder: (record: T) => void = noop,
): [() => Promise<T>, UseWriterStatus] {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<unknown>(undefined)

  // Read via ref (always the latest one passed in), same reasoning as
  // useWriter's own writerRef.
  const builderRef = useRef(builder)
  builderRef.current = builder

  const isMountedRef = useRef(true)
  useEffect(
    () => () => {
      isMountedRef.current = false
    },
    [],
  )

  const run = useCallback(async (): Promise<T> => {
    isMountedRef.current && setIsPending(true)
    isMountedRef.current && setError(undefined)
    try {
      const database = record ? record.database : collection.database
      const result = await database.write(() =>
        record
          ? record.update((r) => builderRef.current(r))
          : collection.create((r) => builderRef.current(r)),
      )
      return result
    } catch (thrownError) {
      isMountedRef.current && setError(thrownError)
      throw thrownError
    } finally {
      isMountedRef.current && setIsPending(false)
    }
  }, [collection, record])

  return [run, { isPending, error }]
}
