import { useCallback, useEffect, useRef, useState } from 'react'
import { noop } from '../utils/fp'
import type Model from '../Model'
import type { ModelClass } from '../Collection'
import type { UseWriterStatus } from './useWriter'
import useDatabase from './useDatabase'

/**
 * The narrower sibling of `useWriter`: no arbitrary writer function, just a
 * field-setting `builder` — the same kind you already pass to
 * `.create()`/`.update()` directly. There's a single rule for which one
 * runs: **pass a `record`, and it updates it; leave `record` out (or pass
 * `null`/`undefined`), and it creates a new one of `modelClass` instead.**
 *
 * ```js
 * import Task from '../models/Task'
 *
 * // update: editing an existing task -- `task` is passed in, so this
 * // always updates it, never creates a new one
 * function useToggleDone(task) {
 *   return useAtomicWriter(Task, task, (task) => {
 *     task.isDone = !task.isDone
 *   })
 * }
 *
 * // create: no record passed in, so this always creates a new one
 * function useAddTask() {
 *   const [title, setTitle] = useState('')
 *   const [addTask, status] = useAtomicWriter(Task, undefined, (task) => {
 *     task.title = title
 *   })
 *   return [addTask, status]
 * }
 *
 * // both at once: the same hook backs a "new task" screen and an "edit
 * // task" screen, just depending on whether `task` was passed in
 * function useSaveTask(task, title) {
 *   return useAtomicWriter(Task, task, (task) => {
 *     task.title = title
 *   })
 * }
 * ```
 *
 * Just the class, not a `Collection` — this hook pulls `Database` from
 * context itself (via `useDatabase()`, the same as `withDatabase`/
 * `useDatabase` elsewhere), so it needs a `<DatabaseProvider>` up the tree.
 * That's a deliberate difference from `useWriter`/`useRecord`/`useQuery`,
 * which take a live record/query and so never need context to find a
 * database — `useAtomicWriter` can be called with *no* record at all (the
 * create case), where there's nothing to pull `.database` off of, so
 * context is the only thing left to source it from either way. Forgetting
 * the Provider fails loudly (`useDatabase`'s own error), not silently.
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
  modelClass: ModelClass<T>,
  record: T | null | undefined,
  builder: (record: T) => void = noop,
): [() => Promise<T>, UseWriterStatus] {
  const database = useDatabase()

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
      const result = await database.write(() =>
        record
          ? record.update((r) => builderRef.current(r))
          : database.get(modelClass).create((r) => builderRef.current(r)),
      )
      return result
    } catch (thrownError) {
      isMountedRef.current && setError(thrownError)
      throw thrownError
    } finally {
      isMountedRef.current && setIsPending(false)
    }
  }, [database, modelClass, record])

  return [run, { isPending, error }]
}
