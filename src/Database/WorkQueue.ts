import { invariant, logger } from '../utils/common'
import { createAsyncVariable } from '../utils/common/asyncContext'
import type { AsyncVariable } from '../utils/common/asyncContext'
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

// A guarded nested promise's `constructor` (see WorkQueue#_guardNested): anything but the
// intrinsic Promise, so a native `await` reads `then`. It still has to work as a constructor --
// Hermes' Promise#then does `new this.constructor(...)` instead of the spec's species lookup --
// and spec-compliant engines use its `Symbol.species`, so promises derived from it are plain.
// Deliberately not a `class extends Promise`: loose Babel class transforms can't subclass builtins.
function PlainPromise<T>(
  executor: (resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
): Promise<T> {
  return new Promise(executor)
}
Object.defineProperty(PlainPromise, Symbol.species, { value: Promise })

function nestedCallError(
  isWriter: boolean,
  name: string | undefined,
  currentWork: WorkQueueItem,
): Error {
  const nestedKind = isWriter ? 'writer' : 'reader'
  const currentKind = currentWork.isWriter ? 'writer' : 'reader'
  return new Error(
    `Nested ${nestedKind} (${name || 'unnamed'}) called from ${currentKind} (${describeWork(
      currentWork,
    )}) without callWriter()/callReader(). This deadlocks.`,
  )
}

export default class WorkQueue {
  _db: Database

  _queue: WorkQueueItem[] = []

  _subActionIncoming: boolean = false

  // experimentalDetectNestedWriters, synchronous fallback: true while the running item's work
  // function is executing synchronously (and for one microtask after followPromise()). Only used
  // when _workContext can't follow every `await` on its own (see _usesPreciseContext()).
  _inWorkTurn: boolean = false

  // experimentalDetectNestedWriters: the queue item the current async flow logically belongs to,
  // followed through `await`s (see utils/common/asyncContext). Created on first use, only when
  // the flag is on.
  _workContext: AsyncVariable<WorkQueueItem> | null = null

  // dev-only: pending stuck-warning timer for the running item (at most one at a time)
  _stuckWatchdog: ReturnType<typeof setTimeout> | undefined = undefined

  constructor(db: Database) {
    this._db = db
  }

  _getWorkContext(): AsyncVariable<WorkQueueItem> | null {
    if (!this._db.experimentalDetectNestedWriters) {
      return null
    }
    if (!this._workContext) {
      this._workContext = createAsyncVariable<WorkQueueItem>()
    }
    return this._workContext
  }

  // AsyncContext / AsyncLocalStorage follow every `await`, so the _inWorkTurn heuristic is
  // redundant there (and its one-microtask window can misattribute unrelated code). The
  // promise-then tier misses natively-executed `await`s (browsers), so it keeps the heuristic as
  // a supplement.
  _usesPreciseContext(): boolean {
    const context = this._getWorkContext()
    return Boolean(context && context.kind !== 'promise-then')
  }

  /**
   * Runs `fn` as if outside any reader/writer, for experimentalDetectNestedWriters' purposes. Used
   * for change notifications: an observer reacting to a writer's changes by starting its own
   * writer isn't a nested call (nothing waits for it) and must simply queue.
   */
  runOutsideWork<T>(fn: () => T): T {
    if (!this._db.experimentalDetectNestedWriters) {
      return fn()
    }
    const wasInWorkTurn = this._inWorkTurn
    this._inWorkTurn = false
    try {
      return this._workContext ? this._workContext.run(undefined, fn) : fn()
    } finally {
      this._inWorkTurn = wasInWorkTurn
    }
  }

  /**
   * When a writer `await`s this promise, mark the next microtask as still inside that writer
   * so a nested write() without callWriter throws.
   */
  followPromise<T>(promise: Promise<T>): Promise<T> {
    if (
      !this._db.experimentalDetectNestedWriters ||
      !this._inWorkTurn ||
      this._usesPreciseContext()
    ) {
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

    // experimentalDetectNestedWriters: called from inside the running item's own async flow?
    let nestedIn: WorkQueueItem | undefined
    if (this._db.experimentalDetectNestedWriters) {
      const currentWork = this._queue[0]
      if (currentWork && this._getWorkContext()?.get() === currentWork) {
        nestedIn = currentWork
      } else if (currentWork && this._inWorkTurn) {
        // Heuristic fallback (see _inWorkTurn) can't tell whether the caller will wait for this
        // one, so it throws right away
        throw nestedCallError(isWriter, description || work.name, currentWork)
      }
    }

    let workItem: WorkQueueItem | undefined
    const promise = new Promise<T>((resolve, reject) => {
      workItem = {
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

    return nestedIn && workItem ? this._guardNested(promise, workItem, nestedIn) : promise
  }

  // `item` was requested from inside `owner`'s own async flow, without callWriter()/callReader().
  // Queueing it behind `owner` is fine on its own (fire-and-forget: "do this once I'm done") --
  // what deadlocks is `owner` then *waiting* for it, since `item` can't start until `owner`
  // finishes. So that's the moment to fail: when `owner` subscribes to the returned promise.
  //
  // Every way of waiting on a promise reads its `then` property synchronously, in the waiter's
  // own async flow: `.then()`/`.catch()`/`.finally()`, `Promise.resolve()`/`Promise.all()`,
  // returning it from an async function or a `.then()` callback (resolve() reads `then`), and
  // `await` -- natively, once `constructor` isn't the intrinsic Promise (otherwise V8/JSC await
  // an unmodified native promise without reading `then`); when compiled by Babel, through
  // `Promise.resolve(x).then(...)`. A getter on `then` sees all of them.
  _guardNested<T>(promise: Promise<T>, item: WorkQueueItem, owner: WorkQueueItem): Promise<T> {
    const context = this._workContext
    const queue = this._queue
    Object.defineProperty(promise, 'then', {
      configurable: true,
      get() {
        if (context?.get() === owner && queue[0] === owner) {
          const index = queue.indexOf(item)
          if (index > 0) {
            queue.splice(index, 1)
            item.reject(nestedCallError(item.isWriter, item.description || item.work.name, owner))
          }
        }
        return Promise.prototype.then
      },
    })
    Object.defineProperty(promise, 'constructor', { configurable: true, value: PlainPromise })
    return promise
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
      const workContext = this._getWorkContext()
      this._inWorkTurn = Boolean(workContext) && !this._usesPreciseContext()
      let workPromise: Promise<unknown>
      try {
        const api = actionInterface(this, workItem)
        workPromise = workContext ? workContext.run(workItem, () => work(api)) : work(api)
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
