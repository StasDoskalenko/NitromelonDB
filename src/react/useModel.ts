import type Model from '../Model'
import useTick from './useTick'

/**
 * Subscribes to a record and re-renders the component on every change
 * (including deletion) — then returns the same record back, for you to read
 * fields off of directly in your render.
 *
 * ```js
 * function NoteTitle({ note }) {
 *   const liveNote = useModel(note)
 *   return <Text>{liveNote.title}</Text>
 * }
 * ```
 *
 * Records are mutated in place, so `note.observe()`/`note.experimentalSubscribe()`
 * never hand you a new object to point React at — it's always the same `note`
 * instance. `useModel` doesn't try to give you a new one either (no cloning):
 * it just forces a re-render on every notification, so the next read of
 * `liveNote.title` above naturally picks up the current value. See
 * useTick for why this doesn't rely on reference equality.
 *
 * `model` may be `null`/`undefined` (e.g. an optional relation that hasn't
 * loaded yet) — passed through as-is, no subscription is set up.
 */
export default function useModel<T extends Model>(model: T): T
export default function useModel<T extends Model | null | undefined>(model: T): T
export default function useModel<T extends Model | null | undefined>(model: T): T {
  useTick((notify) => {
    if (!model) {
      return () => {}
    }
    return model.experimentalSubscribe(notify)
  }, [model])

  return model
}
