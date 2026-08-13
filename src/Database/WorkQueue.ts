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

export default class WorkQueue {
  _db: Database

  _queue: WorkQueueItem[] = []

  _subActionIncoming: boolean = false

  constructor(db: Database) {
    this._db = db
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

    return new Promise((resolve, reject) => {
      const workItem: WorkQueueItem = {
        work: work as WorkQueueItem['work'],
        isWriter,
        resolve: resolve as (value: unknown) => void,
        reject,
        description,
      }

      if (process.env.NODE_ENV !== 'production' && this._queue.length) {
        setTimeout(() => {
          const queue = this._queue
          const current = queue[0]
          if (current === workItem || !queue.includes(workItem)) {
            return
          }

          const enqueuedKind = isWriter ? 'writer' : 'reader'
          const currentKind = current.isWriter ? 'writer' : 'reader'
          logger.warn(
            `The ${enqueuedKind} you're trying to run (${
              description || 'unnamed'
            }) can't be performed yet, because there are ${
              queue.length
            } other readers/writers in the queue.\n\nCurrent ${currentKind}: ${
              current.description || 'unnamed'
            }.\n\nIf everything is working fine, you can safely ignore this message (queueing is working as expected). But if your readers/writers are not running, it's because the current ${currentKind} is stuck.\nRemember that if you're calling a reader/writer from another reader/writer, you must use callReader()/callWriter(). See docs for more details.`,
          )
          logger.log(`Enqueued ${enqueuedKind}:`, work)
          logger.log(`Running ${currentKind}:`, current.work)
        }, 1500)
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

    try {
      const workPromise = work(actionInterface(this, workItem))

      if (process.env.NODE_ENV !== 'production') {
        invariant(
          workPromise instanceof Promise,
          `The function passed to database.${
            isWriter ? 'write' : 'read'
          }() or a method marked as @${
            isWriter ? 'writer' : 'reader'
          } must be asynchronous (marked as 'async' or always returning a promise) (in: ${
            workItem.description || 'unnamed'
          })`,
        )
      }

      resolve(await workPromise)
    } catch (error) {
      reject(error)
    }

    this._queue.shift()

    if (this._queue.length) {
      setTimeout(() => this._executeNext(), 0)
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
