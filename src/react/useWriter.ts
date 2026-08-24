import { useCallback, useEffect, useRef, useState } from 'react'
import invariant from '../utils/common/invariant'
import type Model from '../Model'

export type UseWriterStatus = {
  /** Whether the write triggered by the last call to the returned function is still running. */
  isPending: boolean
  /** Set if that write threw. Cleared at the start of the next call. */
  error: unknown
}

/**
 * Returns a stable callback that runs `writer` inside `model.database.write()`
 * — the hook-friendly equivalent of a `@writer` method, anchored to a
 * specific record so `writer`'s first argument is typed as that record's
 * actual class, not a generic `Model`.
 *
 * ```js
 * function AddComment({ post }) {
 *   const [body, setBody] = useState('')
 *   const [addComment, { isPending, error }] = useWriter(post, async (post, body) => {
 *     await post.database.get('comments').create((comment) => {
 *       comment.post.set(post)
 *       comment.body = body
 *     })
 *   })
 *
 *   return (
 *     <>
 *       <TextInput value={body} onChangeText={setBody} />
 *       <Button title="Add comment" disabled={isPending} onPress={() => addComment(body)} />
 *     </>
 *   )
 * }
 * ```
 *
 * A few mistakes this sidesteps, on purpose:
 * - You can't forget to wrap the mutation in `database.write()` — that's
 *   built in, not something you write yourself each time.
 * - `writer` doesn't need to be memoized, and there's no dependency array to
 *   get wrong: the latest `writer` you passed is always the one that runs
 *   (via a ref), so there's nothing here for `react-hooks/exhaustive-deps`
 *   to warn about and nothing to go stale. The returned callback's own
 *   identity only changes if `model` itself changes.
 * - `isPending` is tracked for you, so it's there to disable a button while
 *   the write is in flight instead of risking a double-submit.
 * - Errors are caught, exposed as `error`, and re-thrown (so `await
 *   addComment(...)` still rejects if you want to handle it locally too)
 *   instead of becoming an unhandled rejection.
 *
 * Note: `writer` runs inside a single Writer, so it can freely read/write
 * multiple records/tables (as in the example above) — it's not limited to
 * `model` itself.
 *
 * `model` may be `null`/`undefined` (e.g. a relation that hasn't loaded
 * yet, matching useRecord/useQuery) — the returned callback rejects if
 * called while it's still nullish, so guard with e.g. `disabled={!post}`.
 *
 * The write itself is never cancelled by unmounting — a real database
 * mutation shouldn't be abandoned mid-flight just because the component
 * asking for it went away. What *is* guarded against is touching
 * `isPending`/`error` state after that point: if the component unmounts
 * while a write is still in flight, its eventual result is only recorded
 * if this hook is still mounted, so it can't try to schedule a render for
 * something that no longer exists.
 */
export default function useWriter<T extends Model, Args extends unknown[] = []>(
  model: T | null | undefined,
  writer: (record: T, ...args: Args) => Promise<void> | void,
): [(...args: Args) => Promise<void>, UseWriterStatus] {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<unknown>(undefined)

  // Read via ref (always the latest one passed in) instead of putting
  // `writer` in useCallback's deps -- see doc comment above.
  const writerRef = useRef(writer)
  writerRef.current = writer

  const isMountedRef = useRef(true)
  useEffect(
    () => () => {
      isMountedRef.current = false
    },
    [],
  )

  const run = useCallback(
    async (...args: Args): Promise<void> => {
      invariant(model, 'useWriter: cannot write, model is null/undefined')
      isMountedRef.current && setIsPending(true)
      isMountedRef.current && setError(undefined)
      try {
        await model.database.write(() => Promise.resolve(writerRef.current(model, ...args)))
      } catch (thrownError) {
        isMountedRef.current && setError(thrownError)
        throw thrownError
      } finally {
        isMountedRef.current && setIsPending(false)
      }
    },
    [model],
  )

  return [run, { isPending, error }]
}
