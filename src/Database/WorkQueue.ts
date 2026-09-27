import { invariant, logger, deprecated } from '../utils/common'
import type Model from '../Model'
import type Database from './index'

export interface ReaderInterface {
  /**
   * Calls a Reader so that it runs as part of the current Reader (or Writer) instead of deadlocking.
   *
   * Specifically, the passed block should immediately call a method decorted with `@reader` or a
   * function whose implementation is wrapped in `db.read()` block.
   *
   * See docs for more details.
   *
   * @example
   * ```
   * db.read(async reader => {
   *   // ...
   *   reader.callReader(() => someOtherReader())
   * })
   * ```
   */
  callReader<T>(reader: () => Promise<T>): Promise<T>
}

export interface WriterInterface extends ReaderInterface {
  /**
   * Calls another Writer so that it runs as part of the current Writer instead of deadlocking.
   *
   * Specifically, the passed block should immediately call a method decorated with `@writer` or
   * a function whose implementation is wrapped in `db.write()` block.
   *
   * See docs for more details.
   *
   * @example
   * ```
   * db.write(async writer => {
   *   // ...
   *   writer.callWriter(() => someOtherWriter())
   * })
   * ```
   */
  callWriter<T>(writer: () => Promise<T>): Promise<T>

  /**
   * @deprecated Use {@link WriterInterface#callWriter} or {@link ReaderInterface#callReader} instead.
   */
  subAction<T>(writer: () => Promise<T>): Promise<T>

  /** @see {Database#batch} */
  batch(...records: ReadonlyArray<Model | Model[] | null | undefined | false>): Promise<void>
}

type WorkQueueItem = {
  work: (api: ReaderInterface | WriterInterface) => Promise<unknown>
  isWriter: boolean
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  description?: string | undefined
  // dev-only: where an undescribed, unnamed item was enqueued from -- see describeWork()
  _stack?: string | undefined
}

class ReaderInterfaceImpl implements ReaderInterface {
  __workItem: WorkQueueItem
  __workQueue: WorkQueue

  constructor(queue: WorkQueue, item: WorkQueueItem) {
    this.__workQueue = queue
    this.__workItem = item
  }

  __validateQueue(): void {
    invariant(
      this.__workQueue._queue[0] === this.__workItem,
      'Illegal call on a reader/writer that should no longer be running',
    )
  }

  callReader<T>(reader: () => Promise<T>): Promise<T> {
    this.__validateQueue()
    return this.__workQueue.subAction(reader)
  }
}

class WriterInterfaceImpl extends ReaderInterfaceImpl implements WriterInterface {
  callWriter<T>(writer: () => Promise<T>): Promise<T> {
    this.__validateQueue()
    return this.__workQueue.subAction(writer)
  }

  subAction<T>(writer: () => Promise<T>): Promise<T> {
    if (process.env.NODE_ENV !== 'production') {
      deprecated('.subAction()', 'Use .callWriter() / .callReader() instead.')
    }
    this.__validateQueue()
    return this.__workQueue.subAction(writer)
  }

  batch(...records: ReadonlyArray<Model | Model[] | null | undefined | false>): Promise<void> {
    this.__validateQueue()
    return this.__workQueue._db.batch(records as Array<Model | null | undefined | false>)
  }
}

const actionInterface = (queue: WorkQueue, item: WorkQueueItem) =>
  item.isWriter ? new WriterInterfaceImpl(queue, item) : new ReaderInterfaceImpl(queue, item)

// Handoff between queued items still goes through a macrotask (not a microtask) -- on purpose,
// so a writer/reader's own continuation code gets a full turn before the next queued item starts
// (see the 'queues writers/readers' test). But `setTimeout(fn, 0)` on React Native is a native
// timer round-trip (~1 frame); `setImmediate` (available on Hermes/Node) is a plain macrotask
// with none of that native cost, so N small queued writes no longer cost N frames of dead time
// waiting for their turn -- which is exactly what used to build the queue that triggers the
// warning below. Falls back to setTimeout on environments without setImmediate (web).
// Checked on every call, not resolved once at module load -- resolving it once would permanently
// capture the *original* global (e.g. Node's real setImmediate), even under fake timers installed
// later (`jest.useFakeTimers()` swaps the global, which a stale reference never sees). Accessed
// via `globalThis` rather than the bare identifier -- `setImmediate` isn't part of any standard
// lib (it's Node/Hermes-specific), so referencing it directly fails to compile in a plain
// ESNext+DOM environment (e.g. examples/typescript's tsconfig, which has neither).
function scheduleNext(fn: () => void): void {
  const globalSetImmediate = (globalThis as { setImmediate?: (fn: () => void) => unknown })
    .setImmediate
  if (typeof globalSetImmediate === 'function') {
    globalSetImmediate(fn)
  } else {
    setTimeout(fn, 0)
  }
}

// How long a running writer/reader can hold the front of the queue, with something else
// waiting, before we warn it might be stuck (dev only).
const STUCK_WARNING_MS = 1500

// Best-effort human-readable name for a queue item, for warnings/logs. Most items have an
// explicit `description` (sync's internal writers, `@writer`/`@reader`-decorated methods). A
// plain `database.write(async () => {...})` with no description has neither -- fall back to the
// function's own name (a named function expression at least reads better than "unnamed"), and
// as a last resort say where it was enqueued from, so "(unnamed)" spam is actually actionable.
function describeWork(item: WorkQueueItem): string {
  if (item.description) return item.description
  const { name } = item.work
  return name ? `${name} (unnamed ${item.isWriter ? 'writer' : 'reader'})` : 'unnamed'
}

export default class WorkQueue {
  _db: Database

  _queue: WorkQueueItem[] = []

  _subActionIncoming: boolean = false

  _inWorkTurn: boolean = false

  constructor(db: Database) {
    this._db = db
  }

  /**
   * When a writer `await`s this promise, mark the next microtask as still inside that writer
   * so a nested write() without callWriter throws.
   */
  followPromise<T>(promise: Promise<T>): Promise<T> {
    if (!this._db.experimentalDetectNestedWriters || !this._inWorkTurn) {
      return promise
    }

    const workItem = this._queue[0]
    return new Promise((resolve, reject) => {
      const resume = (): void => {
        if (this._queue[0] === workItem) {
          this._inWorkTurn = true
        }
      }
      const endResume = (): void => {
        queueMicrotask(() => {
          if (this._queue[0] === workItem) {
            this._inWorkTurn = false
          }
        })
      }

      promise.then(
        (value) => {
          resume()
          resolve(value)
          endResume()
        },
        (error) => {
          resume()
          reject(error)
          endResume()
        },
      )
    })
  }

  get isWriterRunning(): boolean {
    const [item] = this._queue
    return Boolean(item && item.isWriter)
  }

  enqueue<T>(
    work: (writer: WriterInterface) => Promise<T>,
    description: string | undefined,
    isWriter: true,
  ): Promise<T>
  enqueue<T>(
    work: (reader: ReaderInterface) => Promise<T>,
    description: string | undefined,
    isWriter: false,
  ): Promise<T>
  enqueue<T>(
    work: (api: WriterInterface) => Promise<T>,
    description: string | undefined,
    isWriter: boolean,
  ): Promise<T> {
    // If a subAction was scheduled using subAction(), database.write/read() calls skip the line
    if (this._subActionIncoming) {
      this._subActionIncoming = false
      const currentWork = this._queue[0]
      if (!currentWork.isWriter) {
        invariant(!isWriter, 'Cannot call a writer block from a reader block')
      }
      return work(actionInterface(this, currentWork) as unknown as WriterInterface)
    }

    if (this._db.experimentalDetectNestedWriters && this._inWorkTurn) {
      const currentWork = this._queue[0]
      if (currentWork) {
        const nestedKind = isWriter ? 'writer' : 'reader'
        const currentKind = currentWork.isWriter ? 'writer' : 'reader'
        throw new Error(
          `Nested ${nestedKind} (${description || 'unnamed'}) called from ${currentKind} (${
            currentWork.description || 'unnamed'
          }) without callWriter()/callReader(). This deadlocks.`,
        )
      }
    }

    return new Promise((resolve, reject) => {
      const workItem: WorkQueueItem = {
        work: work as WorkQueueItem['work'],
        isWriter,
        resolve: resolve as (value: unknown) => void,
        reject,
        description,
      }

      if (process.env.NODE_ENV !== 'production' && !description && !work.name) {
        // Only pay for a stack capture when we'd otherwise have nothing to call this item by --
        // named/described items skip this.
        workItem._stack = new Error().stack
      }

      this._queue.push(workItem)

      if (this._queue.length === 1) {
        this._executeNext()
      }
    })
  }

  subAction<T>(work: () => Promise<T>): Promise<T> {
    try {
      this._subActionIncoming = true
      const promise = work()
      invariant(
        !this._subActionIncoming,
        'callReader/callWriter call must call a reader/writer synchronously',
      )
      return promise
    } catch (error) {
      this._subActionIncoming = false
      return Promise.reject(error)
    }
  }

  async _executeNext(): Promise<void> {
    const workItem = this._queue[0]
    const { work, resolve, reject, isWriter } = workItem

    // Dev-only stuck detector: one watchdog for the item that's actually running, not one per
    // waiter -- a long-but-progressing writer/reader now warns at most once (about itself, by
    // name), instead of once per thing that piled up behind it in the meantime.
    let watchdog: ReturnType<typeof setTimeout> | undefined
    if (process.env.NODE_ENV !== 'production') {
      watchdog = setTimeout(() => {
        const waitingCount = this._queue.length - 1
        if (waitingCount <= 0) {
          return // queue drained (or moved on) before the watchdog fired -- nothing to warn about
        }
        const kind = isWriter ? 'writer' : 'reader'
        const next = this._queue[1]
        const nextKind = next.isWriter ? 'writer' : 'reader'
        logger.warn(
          `The ${kind} "${describeWork(workItem)}" has been running for ${STUCK_WARNING_MS}ms with ${waitingCount} other reader(s)/writer(s) waiting (next up: ${nextKind} "${describeWork(next)}").\n\nIf it's just doing legitimately slow work, you can ignore this -- queueing is working as expected. But if nothing is progressing, the ${kind} above is stuck. A common cause: calling a reader/writer from inside another reader/writer without callReader()/callWriter() (see experimentalDetectNestedWriters). See docs for more details.`,
        )
        if (workItem._stack) {
          logger.log(`"${describeWork(workItem)}" was enqueued from:`, workItem._stack)
        }
        logger.log(`Running ${kind}:`, work)
        logger.log(
          `Waiting:`,
          this._queue.slice(1).map((item) => item.work),
        )
      }, STUCK_WARNING_MS)
    }

    try {
      this._inWorkTurn = this._db.experimentalDetectNestedWriters
      let workPromise: Promise<unknown>
      try {
        workPromise = work(actionInterface(this, workItem))
      } finally {
        this._inWorkTurn = false
      }

      if (process.env.NODE_ENV !== 'production') {
        invariant(
          workPromise instanceof Promise,
          `The function passed to database.${
            isWriter ? 'write' : 'read'
          }() or a method marked as @${
            isWriter ? 'writer' : 'reader'
          } must be asynchronous (marked as 'async' or always returning a promise) (in: ${describeWork(
            workItem,
          )})`,
        )
      }

      resolve(await workPromise)
    } catch (error) {
      reject(error)
    } finally {
      if (watchdog) clearTimeout(watchdog)
    }

    this._queue.shift()

    if (this._queue.length) {
      scheduleNext(() => this._executeNext())
    }
  }

  _abortPendingWork(): void {
    invariant(this._queue.length >= 1, '_abortPendingWork can only be called from a reader/writer')
    const workToAbort = this._queue.splice(1) // leave only the caller on the queue
    workToAbort.forEach(({ reject }) => {
      reject(new Error('Reader/writer has been aborted because the database was reset'))
    })
  }
}
