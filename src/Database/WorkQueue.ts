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
  // dev-only: stuck-warning bookkeeping -- see _armStuckWatchdog()
  _startedAt?: number | undefined
  _warnedStuck?: boolean | undefined
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

// How long something can wait behind the running writer/reader before we warn that the running
// one might be stuck (dev only).
const STUCK_WARNING_MS = 1500

// Frames to skip when looking for the user function that enqueued an unnamed item: our own
// enqueue path, the Promise executor, and async/generator plumbing added by Babel/regenerator.
const INTERNAL_FRAME_NAMES = new Set([
  'enqueue',
  'write',
  'read',
  'Promise',
  'new', // V8: "at new Promise (<anonymous>)"
  'anonymous',
  '<anonymous>',
  'tryCatch',
  'invoke',
  'step',
  'next',
  '_next',
  'asyncGeneratorStep',
  'processTicksAndRejections',
])
const INTERNAL_FRAME =
  /^(?:WorkQueue\.|Database\.|Generator\.|AsyncGenerator\.|\?anon|_?callee\$?\d*$|_?asyncToGenerator|process\.)/

// Best-effort name of the function that called database.write()/read(), from a stack captured at
// enqueue time. Handles V8/Hermes ("    at fnName (file:1:2)") and JSC/SpiderMonkey
// ("fnName@file:1:2") frames. On React Native everything lives in one bundle, so frames can't be
// told apart by file -- we filter by function name instead. Returns undefined when nothing
// usable is found (e.g. an anonymous arrow in an onPress prop).
export function callerNameFromStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined
  for (const line of stack.split('\n')) {
    const match =
      /^\s*at (?:async )?([^\s(]+)(?: \[as [^\]]+\])? \(/.exec(line) || /^([^@\s]+)@/.exec(line)
    const name = match?.[1]
    if (
      !name ||
      line.includes('node_modules') ||
      INTERNAL_FRAME_NAMES.has(name) ||
      INTERNAL_FRAME.test(name)
    ) {
      continue
    }
    return name
  }
  return undefined
}

// Best-effort human-readable name for a queue item, for warnings/logs. Most items have an
// explicit `description` (sync's internal writers, `@writer`/`@reader`-decorated methods). A
// plain `database.write(async () => {...})` has neither a description nor a function name --
// fall back to the name of the function that called write()/read(), so "unnamed" is actionable.
function describeWork(item: WorkQueueItem): string {
  if (item.description) return item.description
  const kind = item.isWriter ? 'writer' : 'reader'
  const { name } = item.work
  if (name) return `${name} (unnamed ${kind})`
  const caller = callerNameFromStack(item._stack)
  return caller ? `unnamed ${kind} called from ${caller}` : 'unnamed'
}

export default class WorkQueue {
  _db: Database

  _queue: WorkQueueItem[] = []

  _subActionIncoming: boolean = false

  _inWorkTurn: boolean = false

  // dev-only: pending stuck-warning timer for the running item (at most one at a time)
  _stuckWatchdog: ReturnType<typeof setTimeout> | undefined = undefined

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
      } else if (process.env.NODE_ENV !== 'production') {
        this._armStuckWatchdog()
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

    if (process.env.NODE_ENV !== 'production') {
      workItem._startedAt = Date.now()
      this._armStuckWatchdog()
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
      if (this._stuckWatchdog !== undefined) {
        clearTimeout(this._stuckWatchdog)
        this._stuckWatchdog = undefined
      }
    }

    this._queue.shift()

    if (this._queue.length) {
      // Deliberately a macrotask, not a microtask: the finished item's caller gets to run its
      // continuation (and everything it chains) before the next queued item starts, and the JS
      // thread gets a chance to handle timers/events between queued items. Don't swap this for
      // setImmediate -- on React Native's New Architecture that's a queueMicrotask shim.
      setTimeout(() => this._executeNext(), 0)
    }
  }

  // Dev-only stuck detector. Armed when something starts waiting behind the running item (on
  // enqueue, or when an item starts with a backlog already behind it) -- so a writer that only
  // gets stuck late (e.g. a nested write() without callWriter() after a slow await) is still
  // caught. At most one timer at a time, and at most one warning per running item, rather than
  // one per waiter.
  _armStuckWatchdog(): void {
    const running = this._queue[0]
    if (
      this._stuckWatchdog !== undefined ||
      !running ||
      running._warnedStuck ||
      this._queue.length < 2
    ) {
      return
    }
    this._stuckWatchdog = setTimeout(() => {
      this._stuckWatchdog = undefined
      // Still the same item at the front, and still something waiting behind it?
      if (this._queue[0] !== running || this._queue.length < 2) {
        return
      }
      running._warnedStuck = true
      const waitingCount = this._queue.length - 1
      const kind = running.isWriter ? 'writer' : 'reader'
      const next = this._queue[1]
      const nextKind = next.isWriter ? 'writer' : 'reader'
      const runningFor = Date.now() - (running._startedAt ?? Date.now())
      logger.warn(
        `The ${kind} "${describeWork(running)}" has been running for ${runningFor}ms with ${waitingCount} other reader(s)/writer(s) waiting (next up: ${nextKind} "${describeWork(next)}").\n\nIf it's just doing legitimately slow work, you can ignore this -- queueing is working as expected. But if nothing is progressing, the ${kind} above is stuck. A common cause: calling a reader/writer from inside another reader/writer without callReader()/callWriter() (see experimentalDetectNestedWriters). See docs for more details.`,
      )
      if (running._stack) {
        logger.log(`"${describeWork(running)}" was enqueued from:`, running._stack)
      }
      logger.log(`Running ${kind}:`, running.work)
      logger.log(
        `Waiting:`,
        this._queue.slice(1).map((item) => item.work),
      )
    }, STUCK_WARNING_MS)
  }

  _abortPendingWork(): void {
    invariant(this._queue.length >= 1, '_abortPendingWork can only be called from a reader/writer')
    const workToAbort = this._queue.splice(1) // leave only the caller on the queue
    workToAbort.forEach(({ reject }) => {
      reject(new Error('Reader/writer has been aborted because the database was reset'))
    })
  }
}
