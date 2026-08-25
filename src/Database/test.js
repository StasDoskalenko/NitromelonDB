import { expectToRejectWithMessage } from '../__tests__/utils'
import { mockDatabase, MockTask, modelClasses, testSchema } from '../__tests__/testModels'
import { noop } from '../utils/fp'
import { logger } from '../utils/common'
import * as Q from '../QueryDescription'
import { appSchema } from '../Schema'
import { schemaMigrations } from '../Schema/migrations'
import Database from '.'
import { databaseSeed } from './seed'

describe('Database', () => {
  it(`implements get()`, () => {
    const { database } = mockDatabase()
    expect(database.get('mock_tasks').table).toBe('mock_tasks')
    expect(database.get('mock_tasks')).toBe(database.collections.get('mock_tasks'))
    expect(database.get('mock_comments')).toBe(database.collections.get('mock_comments'))
  })

  it(`implements get() with a Model class`, () => {
    const { database } = mockDatabase()
    expect(database.get(MockTask)).toBe(database.get('mock_tasks'))
    expect(database.get(MockTask).modelClass).toBe(MockTask)
  })

  it(`implements localStorage`, async () => {
    const { database } = mockDatabase()
    await database.localStorage.set('foo', 'bar')
    expect(await database.localStorage.get('foo')).toBe('bar')
  })

  describe('unsafeResetDatabase', () => {
    it('can reset database', async () => {
      const { database, tasks } = mockDatabase()

      const m1 = await database.write(() => tasks.create())
      const m2 = await database.write(() => tasks.create())

      expect(await tasks.find(m1.id)).toBe(m1)
      expect(await tasks.find(m2.id)).toBe(m2)

      // reset
      await database.write(() => database.unsafeResetDatabase())

      await expectToRejectWithMessage(tasks.find(m1.id), 'not found')
      await expectToRejectWithMessage(tasks.find(m2.id), 'not found')
    })
    it('throws error if reset is called from outside a writer', async () => {
      const { database, tasks } = mockDatabase()
      const m1 = await database.write(() => tasks.create())

      await expectToRejectWithMessage(
        database.unsafeResetDatabase(),
        'can only be called from inside of a Writer',
      )
      await expectToRejectWithMessage(
        database.read(() => database.unsafeResetDatabase()),
        'can only be called from inside of a Writer',
      )

      expect(await tasks.find(m1.id)).toBe(m1)
    })
    it('increments reset count after every reset', async () => {
      const { database } = mockDatabase()
      expect(database._resetCount).toBe(0)

      await database.write(() => database.unsafeResetDatabase())
      expect(database._resetCount).toBe(1)

      await database.write(() => database.unsafeResetDatabase())
      expect(database._resetCount).toBe(2)
    })
    it('prevents Adapter from being called during reset db', async () => {
      const { database } = mockDatabase()

      const checkAdapter = async () => {
        expect(await database.adapter.getLocal('test')).toBe(null)
        expect(database.adapter.underlyingAdapter).not.toBeFalsy()
        expect(database.adapter.schema).not.toBeFalsy()
      }
      await checkAdapter()

      const resetPromise = database.write(() => database.unsafeResetDatabase())

      expect(() => database.adapter.underlyingAdapter).toThrow(
        /Cannot call database.adapter.underlyingAdapter while the database is being reset/,
      )
      expect(() => database.adapter.schema).toThrow(/Cannot call database.adapter.schema/)
      expect(() => database.adapter.migrations).toThrow(/Cannot call database.adapter.migrations/)
      expect(() => database.adapter.getLocal('test')).toThrow(
        /Cannot call database.adapter.getLocal/,
      )
      expect(() => database.adapter.setLocal('test', 'trap')).toThrow(
        /Cannot call database.adapter.setLocal/,
      )

      await resetPromise
      await checkAdapter()
    })
    it('Cancels Database experimental subscribers during reset', async () => {
      const { database, tasks } = mockDatabase()

      // sanity check first
      const subscriber1 = jest.fn()
      const unsubscribe1 = database.experimentalSubscribe(['mock_tasks'], subscriber1)
      await database.write(() => tasks.create())
      expect(subscriber1).toHaveBeenCalledTimes(1)
      unsubscribe1()
      await database.write(() => database.unsafeResetDatabase())
      await database.write(() => tasks.create())
      expect(subscriber1).toHaveBeenCalledTimes(1)

      // keep subscriber during reset
      const subscriber2 = jest.fn()
      database.experimentalSubscribe(['mock_tasks'], subscriber2)
      const consoleErrorSpy = jest.spyOn(console, 'log')

      await database.write(() => database.unsafeResetDatabase())

      // check that error was logged
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Application error! Unexpected 1 Database subscribers were detected during database.unsafeResetDatabase() call. App should not hold onto subscriptions or Watermelon objects while resetting database.',
      )

      // check that subscriber was killed
      await database.write(() => tasks.create())
      expect(subscriber2).toHaveBeenCalledTimes(0)
    })
    it('invalidates cached Query subscriptions that (against guidance) survived a reset, so they self-heal with fresh data instead of serving stale/pre-reset data forever', async () => {
      const { database, tasks } = mockDatabase()
      const query = tasks.query()

      const t1 = await database.write(() => tasks.create())

      const observer = jest.fn()
      // NOTE: intentionally never unsubscribed -- this is the documented-
      // against but realistic case of a component/hook staying mounted
      // across a logout/login that resets the database
      query.experimentalSubscribe(observer)
      expect(observer).toHaveBeenLastCalledWith([t1])

      await database.write(() => database.unsafeResetDatabase())

      // instead of staying frozen on [t1] (pre-reset data) forever, the
      // still-active subscription is invalidated and immediately refetches
      // against the now-empty, post-reset database
      expect(observer).toHaveBeenLastCalledWith([])

      // having recovered, it keeps tracking new data normally
      const t2 = await database.write(() => tasks.create())
      expect(observer).toHaveBeenLastCalledWith([t2])
    })
    it('invalidates cached Query.experimentalSubscribeWithColumns() subscriptions that survived a reset the same way', async () => {
      const { database, tasks } = mockDatabase()
      const query = tasks.query()

      const t1 = await database.write(() => tasks.create((task) => (task.name = 'before')))

      const observer = jest.fn()
      query.experimentalSubscribeWithColumns(['name'], observer)
      expect(observer).toHaveBeenLastCalledWith([t1])

      await database.write(() => database.unsafeResetDatabase())
      expect(observer).toHaveBeenLastCalledWith([])

      const t2 = await database.write(() => tasks.create((task) => (task.name = 'after')))
      expect(observer).toHaveBeenLastCalledWith([t2])
    })
    it('does not touch cached Query subscriptions that were correctly unsubscribed before the reset', async () => {
      const { database, tasks } = mockDatabase()
      const query = tasks.query()

      const t1 = await database.write(() => tasks.create())

      const observer = jest.fn()
      const unsubscribe = query.experimentalSubscribe(observer)
      expect(observer).toHaveBeenLastCalledWith([t1])
      unsubscribe()

      await database.write(() => database.unsafeResetDatabase())

      // no further calls -- correctly unsubscribed, so nothing to invalidate
      expect(observer).toHaveBeenCalledTimes(1)
    })
    it.skip('Cancels withChangesForTables observation during reset', async () => {})
    it.skip('Cancels Collection change observation during reset', async () => {})
    it.skip('Cancels Collection experimental subscribers during reset', async () => {})
    it.skip('Cancels Model change observation during reset', async () => {})
    it.skip('Cancels Model experimental subscribers during reset', async () => {})
    it.skip('Cancels Query observation during reset', async () => {})
    it.skip('Cancels Query experimental subscribers during reset', async () => {})
    it.skip('Cancels Relation observation during reset', async () => {})
    it.skip('Cancels Relation experimental subscribers during reset', async () => {})
    it('Signals internally when database is being reset', async () => {
      const { database } = mockDatabase()

      expect(database._isBeingReset).toBe(false)
      const promise = database.write(() => database.unsafeResetDatabase())
      expect(database._isBeingReset).toBe(true)
      await promise
      expect(database._isBeingReset).toBe(false)

      // force reset to fail
      database.adapter.unsafeResetDatabase = async () => {
        throw new Error('forced')
      }
      const promise2 = database.write(() => database.unsafeResetDatabase())
      expect(database._isBeingReset).toBe(true)
      await expectToRejectWithMessage(promise2, 'forced')
      expect(database._isBeingReset).toBe(false)
    })
    it.skip('Disallows <many methods> calls during reset', async () => {})
    it.skip('Makes old Model objects unsable after reset', async () => {})
    it.skip('Makes old Query objects unsable after reset', async () => {})
    it.skip('Makes old Relation objects unsable after reset', async () => {})
    // TODO: Write a regression test for https://github.com/Nozbe/WatermelonDB/commit/237e041d0d8aa4b3529fbf522f8d29c776fd4c0e
  })

  describe('resetObservablesCache', () => {
    it('lets Query observers recover from data changed outside the Watermelon write path (e.g. a raw/unsafe write)', async () => {
      const { database, tasks } = mockDatabase()
      const query = tasks.query()

      const t1 = await database.write(() => tasks.create())

      const observer = jest.fn()
      query.experimentalSubscribe(observer)
      expect(observer).toHaveBeenLastCalledWith([t1])

      // simulate a manual/unsafe wipe that bypasses Watermelon's write path
      // entirely -- no Collection._notify happens, so the subscription
      // above has no way of knowing anything changed on its own
      await database.write(() =>
        database.adapter.unsafeExecute({
          loki: (loki) => {
            loki.getCollection('mock_tasks').findAndRemove({})
          },
        }),
      )
      // without resetObservablesCache(), the subscriber is still stuck on [t1]
      expect(observer).toHaveBeenLastCalledWith([t1])

      await database.write(async () => database.resetObservablesCache())
      expect(observer).toHaveBeenLastCalledWith([])
    })
    it('throws if called from outside a writer', async () => {
      const { database } = mockDatabase()
      expect(() => database.resetObservablesCache()).toThrow(
        'can only be called from inside of a Writer',
      )
    })
  })

  describe('Database.batch()', () => {
    it('can batch records', async () => {
      let {
        database,
        // eslint-disable-next-line
        cloneDatabase,
        tasks: tasksCollection,
        comments: commentsCollection,
      } = mockDatabase()
      const adapterBatchSpy = jest.spyOn(database.adapter, 'batch')

      // m1, m2 will be used to test batch-updates
      const m1 = await database.write(() => tasksCollection.create())
      const m2 = await database.write(() => commentsCollection.create())

      // m3, m4 will be used to test batch-deletes
      const m3 = await database.write(() => tasksCollection.create())
      const m4 = await database.write(() => commentsCollection.create())

      const tasksCollectionObserver = jest.fn()
      tasksCollection.changes.subscribe(tasksCollectionObserver)

      const commentsCollectionObserver = jest.fn()
      commentsCollection.changes.subscribe(commentsCollectionObserver)

      // m5, m6 will be used to test batch-creates
      const m5 = tasksCollection.prepareCreate()
      const m6 = commentsCollection.prepareCreate()

      const recordObserver = jest.fn()
      m1.observe().subscribe(recordObserver)

      const batchPromise = database.write(() =>
        database.batch(
          m6,
          m1.prepareUpdate(() => {
            m1.name = 'bar1'
          }),
          m5,
          m2.prepareUpdate(() => {
            m2.body = 'baz1'
          }),
          m3.prepareMarkAsDeleted(),
          m4.prepareDestroyPermanently(),
        ),
      )

      expect(m1._preparedState).toBe(null)
      expect(m2._preparedState).toBe(null)

      await batchPromise

      expect(adapterBatchSpy).toHaveBeenCalledTimes(5)
      expect(adapterBatchSpy).toHaveBeenLastCalledWith([
        ['create', 'mock_comments', m6._raw],
        ['update', 'mock_tasks', m1._raw],
        ['create', 'mock_tasks', m5._raw],
        ['update', 'mock_comments', m2._raw],
        ['markAsDeleted', 'mock_tasks', m3.id],
        ['destroyPermanently', 'mock_comments', m4.id],
      ])

      expect(tasksCollectionObserver).toHaveBeenCalledTimes(1)
      expect(commentsCollectionObserver).toHaveBeenCalledTimes(1)
      expect(tasksCollectionObserver).toHaveBeenCalledWith([
        { record: m1, type: 'updated' },
        { record: m5, type: 'created' },
        { record: m3, type: 'destroyed' },
      ])
      expect(commentsCollectionObserver).toHaveBeenCalledWith([
        { record: m6, type: 'created' },
        { record: m2, type: 'updated' },
        { record: m4, type: 'destroyed' },
      ])

      const createdRecords = [m5, m6]
      createdRecords.forEach((record) => {
        expect(record._preparedState).toBe(null)
        expect(record.collection._cache.get(record.id)).toBe(record)
      })

      expect(recordObserver).toHaveBeenCalledTimes(2)

      // simulate reload -- check if changes actually got saved
      database = await cloneDatabase()
      tasksCollection = database.collections.get('mock_tasks')
      commentsCollection = database.collections.get('mock_comments')

      const fetchedM1 = await tasksCollection.find(m1.id)
      const fetchedM2 = await commentsCollection.find(m2.id)
      expect(fetchedM1.name).toBe('bar1')
      expect(fetchedM2.body).toBe('baz1')

      const fetchedM3 = await tasksCollection.find(m3.id)
      const fetchedM4 = await commentsCollection.query(Q.where('id', m4.id)).fetch()
      expect(fetchedM3._raw._status).toBe('deleted')
      expect(fetchedM4.length).toBe(0)
    })
    it('ignores falsy values passed', async () => {
      const { database, tasks: tasksCollection } = mockDatabase()
      const adapterBatchSpy = jest.spyOn(database.adapter, 'batch')

      const model = tasksCollection.prepareCreate()
      await database.write(() => database.batch(null, model, false, undefined))

      expect(adapterBatchSpy).toHaveBeenCalledTimes(1)
      expect(adapterBatchSpy).toHaveBeenLastCalledWith([['create', 'mock_tasks', model._raw]])
    })
    it(`can batch with an array passed as argument`, async () => {
      const { database, tasks: tasksCollection } = mockDatabase()
      const adapterBatchSpy = jest.spyOn(database.adapter, 'batch')

      const model = tasksCollection.prepareCreate()
      await database.write(() => database.batch([null, model, false, undefined]))

      expect(adapterBatchSpy).toHaveBeenCalledTimes(1)
      expect(adapterBatchSpy).toHaveBeenLastCalledWith([['create', 'mock_tasks', model._raw]])
    })
    it('throws error if attempting to batch records without a pending operation', async () => {
      const { database, tasks } = mockDatabase()
      const m1 = await database.write(() => tasks.create())

      await expectToRejectWithMessage(
        database.write(() => database.batch(m1)),
        'prepared create/update/delete',
      )
    })
    it(`throws error if attempting to batch a disposable record`, async () => {
      const { database, tasks } = mockDatabase()
      const m1 = tasks.disposableFromDirtyRaw({ name: 'hello' })

      await expectToRejectWithMessage(
        database.write(() => database.batch(m1)),
        'disposable',
      )
    })
    it('throws error if batch is called outside of a writer', async () => {
      const { database, tasks } = mockDatabase()

      await expectToRejectWithMessage(
        database.batch(tasks.prepareCreate(noop)),
        'can only be called from inside of a Writer',
      )
      await expectToRejectWithMessage(
        database.read(() => database.batch(tasks.prepareCreate(noop))),
        'can only be called from inside of a Writer',
      )

      // check if in writer is successful
      await database.write(() =>
        database.batch(
          tasks.prepareCreate((task) => {
            task.name = 'foo1'
          }),
        ),
      )
      const [task] = await tasks.query().fetch()
      expect(task.name).toBe('foo1')
    })
    it(`throws an error if invalid arguments`, async () => {
      const { database } = mockDatabase()
      await expectToRejectWithMessage(database.batch([], null), 'multiple arrays were passed')
    })
    it(`prints debug information in verbose mode`, async () => {
      const { database, tasks, projects } = mockDatabase()
      const spy = jest.spyOn(logger, 'debug')

      database.experimentalIsVerbose = true

      await database.write(async () => {
        const t1 = tasks.prepareCreate()
        const t2 = tasks.prepareCreate()
        const p1 = projects.prepareCreate()

        await database.batch(t1, t2, p1)
        expect(spy).toHaveBeenCalledWith(`prepareCreate: mock_tasks#${t1.id}`)
        expect(spy).toHaveBeenCalledWith(`prepareCreate: mock_tasks#${t2.id}`)
        expect(spy).toHaveBeenCalledWith(`prepareCreate: mock_projects#${p1.id}`)
        expect(spy).toHaveBeenLastCalledWith(
          `batch: create mock_tasks#${t1.id}, create mock_tasks#${t2.id}, create mock_projects#${p1.id}`,
        )

        t1.prepareUpdate()
        t2.prepareMarkAsDeleted()
        p1.prepareDestroyPermanently()

        await database.batch(t1, t2, p1)

        expect(spy).toHaveBeenCalledWith(`prepareUpdate: mock_tasks#${t1.id}`)
        expect(spy).toHaveBeenCalledWith(`prepareMarkAsDeleted: mock_tasks#${t2.id}`)
        expect(spy).toHaveBeenCalledWith(`prepareDestroyPermanently: mock_projects#${p1.id}`)
        expect(spy).toHaveBeenLastCalledWith(
          `batch: update mock_tasks#${t1.id}, markAsDeleted mock_tasks#${t2.id}, destroyPermanently mock_projects#${p1.id}`,
        )
      })
    })
  })

  describe('Observation', () => {
    it('implements withChangesForTables', async () => {
      const { database, projects, tasks, comments } = mockDatabase()

      const observer = jest.fn()
      database.withChangesForTables(['mock_projects', 'mock_tasks']).subscribe(observer)

      expect(observer).toHaveBeenCalledTimes(1)

      await database.write(() => projects.create())
      const m1 = await database.write(() => projects.create())
      const m2 = await database.write(() => tasks.create())
      const m3 = await database.write(() => comments.create())

      expect(observer).toHaveBeenCalledTimes(4)
      expect(observer).toHaveBeenCalledWith([{ record: m1, type: 'created' }])
      expect(observer).toHaveBeenLastCalledWith([{ record: m2, type: 'created' }])

      await database.write(async () => {
        await m1.update()
        await m2.update()
        await m3.update()
      })

      expect(observer).toHaveBeenCalledTimes(6)
      expect(observer).toHaveBeenLastCalledWith([{ record: m2, type: 'updated' }])

      await database.write(async () => {
        await m1.destroyPermanently()
        await m2.destroyPermanently()
        await m3.destroyPermanently()
      })

      expect(observer).toHaveBeenCalledTimes(8)
      expect(observer).toHaveBeenCalledWith([{ record: m1, type: 'destroyed' }])
      expect(observer).toHaveBeenLastCalledWith([{ record: m2, type: 'destroyed' }])
    })
    it('can subscribe to change signals for particular tables', async () => {
      const { database, projects, tasks, comments } = mockDatabase()

      const subscriber1 = jest.fn()
      const unsubscribe1 = database.experimentalSubscribe([], subscriber1)

      await database.write(() => tasks.create())

      const subscriber2 = jest.fn()
      const unsubscribe2 = database.experimentalSubscribe(['mock_tasks'], subscriber2)

      const subscriber3 = jest.fn()
      const unsubscribe3 = database.experimentalSubscribe(
        ['mock_tasks', 'mock_projects'],
        subscriber3,
      )

      const p1 = await database.write(() => projects.create())
      await database.write(() => tasks.create())
      await database.write(() => comments.create())

      expect(subscriber1).toHaveBeenCalledTimes(0)
      expect(subscriber2).toHaveBeenCalledTimes(1)
      expect(subscriber3).toHaveBeenCalledTimes(2)
      expect(subscriber2).toHaveBeenLastCalledWith()

      await database.write(() =>
        database.batch(projects.prepareCreate(), projects.prepareCreate(), tasks.prepareCreate()),
      )

      expect(subscriber2).toHaveBeenCalledTimes(2)
      expect(subscriber3).toHaveBeenCalledTimes(3)

      await database.write(() => p1.update())

      expect(subscriber2).toHaveBeenCalledTimes(2)
      expect(subscriber3).toHaveBeenCalledTimes(4)

      unsubscribe1()
      unsubscribe2()

      await database.write(() =>
        database.batch(tasks.prepareCreate(), p1.prepareDestroyPermanently()),
      )

      expect(subscriber1).toHaveBeenCalledTimes(0)
      expect(subscriber2).toHaveBeenCalledTimes(2)
      expect(subscriber3).toHaveBeenCalledTimes(5)
      unsubscribe3()
    })
    it('unsubscribe can safely be called more than once', async () => {
      const { database, tasks } = mockDatabase()

      const subscriber1 = jest.fn()
      const unsubscribe1 = database.experimentalSubscribe(['mock_tasks'], subscriber1)
      expect(subscriber1).toHaveBeenCalledTimes(0)

      const unsubscribe2 = database.experimentalSubscribe(['mock_tasks'], () => {})
      unsubscribe2()
      unsubscribe2()

      await database.write(() => tasks.create())

      expect(subscriber1).toHaveBeenCalledTimes(1)
      unsubscribe1()
    })
    it(`can subscribe with the same subscriber multiple times`, async () => {
      const { database, tasks } = mockDatabase()

      const subscriber = jest.fn()
      const unsubscribe1 = database.experimentalSubscribe(['mock_tasks'], subscriber)

      await database.write(() => tasks.create())
      expect(subscriber).toHaveBeenCalledTimes(1)

      const unsubscribe2 = database.experimentalSubscribe(['mock_tasks'], subscriber)

      await database.write(() => tasks.create())
      expect(subscriber).toHaveBeenCalledTimes(3)
      unsubscribe2()
      unsubscribe2() // noop
      await database.write(() => tasks.create())
      expect(subscriber).toHaveBeenCalledTimes(4)
      unsubscribe1()
      await database.write(() => tasks.create())
      expect(subscriber).toHaveBeenCalledTimes(4)
    })
    it('has new objects cached before calling subscribers (regression test)', async () => {
      const { database, projects, tasks } = mockDatabase()

      const project = projects.prepareCreate()
      const task = tasks.prepareCreate((t) => {
        t.project.set(project)
      })

      let observerCalled = 0
      let taskPromise = null
      const observer = jest.fn(() => {
        observerCalled += 1
        if (observerCalled === 1) {
          // nothing happens
        } else if (observerCalled === 2) {
          taskPromise = tasks.find(task.id)
        }
      })
      database.withChangesForTables(['mock_projects']).subscribe(observer)
      expect(observer).toHaveBeenCalledTimes(1)

      await database.write(() => database.batch(project, task))
      expect(observer).toHaveBeenCalledTimes(2)

      // check if task is already cached
      expect(await taskPromise).toBe(task)
    })
  })

  const delayPromise = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 100)
    })

  describe('Database readers/writers', () => {
    it('can execute a writer block', async () => {
      const { database } = mockDatabase()

      const action = jest.fn(() => Promise.resolve(true))
      await database.write(action)

      expect(action).toHaveBeenCalledTimes(1)
    })
    it('Database.action() is a deprecated alias of write()', async () => {
      const { database } = mockDatabase()

      const work = jest.fn(() => Promise.resolve(true))
      await database.action(work)

      expect(work).toHaveBeenCalledTimes(1)
    })
    it('queues writers/readers', async () => {
      const { database } = mockDatabase()

      const actions = [jest.fn(delayPromise), jest.fn(delayPromise), jest.fn(delayPromise)]

      const promise0 = database.write(actions[0])
      database.read(actions[1])

      expect(actions[0]).toHaveBeenCalledTimes(1)
      expect(actions[1]).toHaveBeenCalledTimes(0)

      await promise0
      const promise2 = database.write(actions[2])

      expect(actions[0]).toHaveBeenCalledTimes(1)
      expect(actions[1]).toHaveBeenCalledTimes(0)
      expect(actions[2]).toHaveBeenCalledTimes(0)

      await promise2

      expect(actions[0]).toHaveBeenCalledTimes(1)
      expect(actions[1]).toHaveBeenCalledTimes(1)
      expect(actions[2]).toHaveBeenCalledTimes(1)

      // after queue is empty I can queue again and have result immediately
      const writer3 = jest.fn(async () => 42)
      const promise3 = database.write(writer3)
      expect(writer3).toHaveBeenCalledTimes(1)
      await promise3
    })
    it('returns value from reader/writer', async () => {
      const { database } = mockDatabase()
      expect(await database.write(async () => 42)).toBe(42)
      expect(await database.read(async () => 420)).toBe(420)
    })
    it('passes error from reader/writer', async () => {
      const { database } = mockDatabase()
      await expectToRejectWithMessage(
        database.write(async () => {
          throw new Error('test error')
        }),
        'test error',
      )
    })
    it(`can distinguish between writers and readers running`, async () => {
      const { db } = mockDatabase()
      const actions = [jest.fn(delayPromise), jest.fn(delayPromise), jest.fn(delayPromise)]

      const promise0 = db.write(actions[0])
      db.read(actions[1])
      expect(db._workQueue.isWriterRunning).toBe(true)

      await promise0
      const promise2 = db.write(actions[2])
      expect(db._workQueue.isWriterRunning).toBe(false)

      await promise2
      expect(db._workQueue.isWriterRunning).toBe(false)

      const promise3 = db.write(async () => 42)
      expect(db._workQueue.isWriterRunning).toBe(true)
      await promise3
      expect(db._workQueue.isWriterRunning).toBe(false)
    })
    it('queues actions correctly even if some error out', async () => {
      const { database } = mockDatabase()

      const actions = [
        async () => true,
        async () => {
          throw new Error('error1') // async error
        },
        async () => {
          await delayPromise()
          return 42
        },
        () => {
          throw new Error('error2') // sync error
        },
        () => delayPromise(),
      ]
      const promises = actions.map((action) =>
        database.write(action).then(
          // jest will automatically fail the test if a promise rejects even though we're testing it later
          (value) => ['value', value],
          (error) => ['error', error],
        ),
      )
      await promises[4]

      // after queue is empty I can queue again
      const action5 = jest.fn(async () => 42)
      const promise5 = database.read(action5)
      expect(action5).toHaveBeenCalledTimes(1)

      // check if right answers
      expect(await promises[0]).toEqual(['value', true])
      expect(await promises[1]).toMatchObject(['error', { message: 'error1' }])
      expect(await promises[2]).toEqual(['value', 42])
      expect(await promises[3]).toMatchObject(['error', { message: 'error2' }])
      expect(await promises[4]).toEqual(['value', undefined])
      await promise5
    })
    it('action calling another action directly will get stuck', async () => {
      const { database } = mockDatabase()

      let called = 0
      const subaction = () =>
        database.write(async () => {
          called += 1
        })

      await database.write(() => {
        subaction()
        return delayPromise() // don't await subaction, just see it will never be called
      })
      expect(called).toBe(0)
    })
    it('experimentalDetectNestedWriters throws instead of deadlocking on nested writers', async () => {
      const { database } = mockDatabase({ experimentalDetectNestedWriters: true })

      const nested = () => database.write(async () => 1, 'nested writer')

      await expectToRejectWithMessage(
        database.write(async () => nested(), 'outer writer'),
        'This deadlocks',
      )

      await expectToRejectWithMessage(
        database.write(async () => {
          nested()
        }, 'outer writer'),
        'This deadlocks',
      )
    })
    it('experimentalDetectNestedWriters throws on nested readers without callReader', async () => {
      const { database } = mockDatabase({ experimentalDetectNestedWriters: true })

      const nested = () => database.read(async () => 1, 'nested reader')

      await expectToRejectWithMessage(
        database.write(async () => nested(), 'outer writer'),
        'This deadlocks',
      )
    })
    it('experimentalDetectNestedWriters still allows callWriter/callReader and queued writers', async () => {
      const { database } = mockDatabase({ experimentalDetectNestedWriters: true })

      const nested = () => database.write(async () => 42, 'nested writer')
      expect(
        await database.write(async (writer) => writer.callWriter(() => nested()), 'outer writer'),
      ).toBe(42)

      const first = database.write(delayPromise, 'first writer')
      const second = database.write(async () => 'queued', 'second writer')
      await first
      expect(await second).toBe('queued')
    })
    it('experimentalDetectNestedWriters throws after await find without callWriter', async () => {
      const { database, tasks } = mockDatabase({ experimentalDetectNestedWriters: true })
      const task = await database.write(() => tasks.create())
      const nested = () => database.write(async () => 1, 'nested writer')

      await expectToRejectWithMessage(
        database.write(async () => {
          await tasks.find(task.id)
          await nested()
        }, 'outer writer'),
        'This deadlocks',
      )
    })
    it('experimentalDetectNestedWriters throws after a cached find without callWriter', async () => {
      const { database, tasks } = mockDatabase({ experimentalDetectNestedWriters: true })
      const task = await database.write(() => tasks.create())
      await tasks.find(task.id)
      const nested = () => database.write(async () => 1, 'nested writer')

      await expectToRejectWithMessage(
        database.write(async () => {
          await tasks.find(task.id)
          await nested()
        }, 'outer writer'),
        'This deadlocks',
      )
    })
    it('experimentalDetectNestedWriters still queues writers started after an adapter await', async () => {
      const { database, tasks } = mockDatabase({ experimentalDetectNestedWriters: true })
      const task = await database.write(() => tasks.create())

      const first = database.write(async () => {
        await tasks.find(task.id)
        await delayPromise()
      }, 'first writer')
      const second = database.write(async () => 'queued', 'second writer')
      await first
      expect(await second).toBe('queued')
    })
    it('experimentalDetectNestedWriters still allows callWriter after await find', async () => {
      const { database, tasks } = mockDatabase({ experimentalDetectNestedWriters: true })
      const task = await database.write(() => tasks.create())
      const nested = () => database.write(async () => 42, 'nested writer')

      expect(
        await database.write(async (writer) => {
          await tasks.find(task.id)
          return writer.callWriter(() => nested())
        }, 'outer writer'),
      ).toBe(42)
    })
    it(`can call readers with callReader`, async () => {
      const { db } = mockDatabase()

      const action1 = () => db.read(async () => 42)
      const action2 = () => db.read(async (reader) => reader.callReader(() => action1()))
      const action3 = () => db.read(async (reader) => reader.callReader(() => action2()))
      expect(await action3()).toBe(42)
    })
    it(`can call writers with callWriter`, async () => {
      const { db } = mockDatabase()

      const action0 = () => db.read(async () => 42)
      const action1 = () => db.write(async (writer) => writer.callReader(() => action0()))
      const action2 = () => db.write(async (writer) => writer.callWriter(() => action1()))
      const action3 = () => db.write(async (writer) => writer.subAction(() => action2()))
      expect(await action3()).toBe(42)
    })
    it(`cannot call writers from readers`, async () => {
      const { db } = mockDatabase()

      const writer = () => db.write(async () => 42)
      await expectToRejectWithMessage(
        db.read(async (reader) => reader.callWriter(() => writer())),
        'is not a function',
      )
      await expectToRejectWithMessage(
        db.read(async (reader) => reader.callReader(() => writer())),
        'Cannot call a writer block from a reader block',
      )
    })
    it('sub actions skip the line only once', async () => {
      const { db } = mockDatabase()

      let called1 = 0
      let called2 = 0

      const action1 = () =>
        db.write(async () => {
          called1 += 1
        })
      const action2 = () =>
        db.write(async () => {
          called2 += 1
        })
      await db.write((writer) => {
        writer.callWriter(() => action1())
        action2()
        return delayPromise() // don't await subaction, just see it will never be called
      })
      expect(called1).toBe(1)
      expect(called2).toBe(0)
    })
    it(`ensures that callReader/callWriter calls a reader/writer`, async () => {
      const { db } = mockDatabase()
      const expectError = (promise) =>
        expectToRejectWithMessage(
          promise,
          'callReader/callWriter call must call a reader/writer synchronously',
        )
      const action = () => db.write(async () => 42)
      await expectError(db.write(async (writer) => writer.callWriter(() => {})))
      await expectError(db.write(async (writer) => writer.callReader(() => {})))
      await expectError(db.read(async (reader) => reader.callReader(() => {})))
      await expectError(
        db.write(async (writer) =>
          writer.callWriter(async () => {
            await delayPromise()
            return action()
          }),
        ),
      )
    })
    it(`can batch from a writer interface`, async () => {
      const { db, tasks } = mockDatabase()
      const adapterBatchSpy = jest.spyOn(db.adapter, 'batch')

      let t1, t2
      await db.write(async (writer) => {
        t1 = await tasks.create()
        t2 = tasks.prepareCreate()
        await writer.batch(
          t2,
          t1.prepareUpdate(() => {}),
          null,
          false,
          undefined,
        )
      })

      expect(adapterBatchSpy).toHaveBeenCalledTimes(2)
      expect(adapterBatchSpy).toHaveBeenLastCalledWith([
        ['create', 'mock_tasks', t2._raw],
        ['update', 'mock_tasks', t1._raw],
      ])
    })
    it(`ensures that reader/writer interface is not used after block is done`, async () => {
      const { db } = mockDatabase()

      const sth = () => db.read(async () => 42)

      let saved
      const action0 = () =>
        db.write(async (writer) => {
          saved = writer
        })
      const promise = action0()
      saved.callReader(() => sth())
      saved.callWriter(() => sth())
      saved.subAction(() => sth())
      saved.batch()
      await promise

      const expectError = (work) =>
        expect(work).toThrow('Illegal call on a reader/writer that should no longer be running')
      expectError(() => saved.callReader(() => sth()))
      expectError(() => saved.callWriter(() => sth()))
      expectError(() => saved.subAction(() => sth()))
      expectError(() => saved.batch())

      db.write(async () => {})
      expectError(() => saved.callReader(() => sth()))
    })
    it('aborts all pending actions if database is reset', async () => {
      const { database } = mockDatabase()

      let promise1
      let promise2
      let promise3
      let dangerousActionsCalled = 0
      let safeActionsCalled = 0

      const manyActions = async () => {
        // this will be called before reset:
        promise1 = database.write(async () => 1)
        await promise1

        // this will be called after reset:
        promise2 = database.write(async () => {
          dangerousActionsCalled += 1
        })
        await promise2

        promise3 = database.read(async () => {
          dangerousActionsCalled += 1
        })
        await promise3
      }

      const promises = manyActions().catch((e) => e)
      await database.write(() => database.unsafeResetDatabase())

      // actions beyond unsafe reset should be successful
      await Promise.all([
        database.write(async () => {
          safeActionsCalled += 1
        }),
        database.read(async () => {
          safeActionsCalled += 1
        }),
      ])

      expect(await promises).toMatchObject({ message: expect.stringMatching('database was reset') })

      expect(await promise1).toBe(1)
      await expectToRejectWithMessage(promise2, 'database was reset')
      expect(promise3).toBe(undefined) // code will never reach this point
      expect(dangerousActionsCalled).toBe(0)
      expect(safeActionsCalled).toBe(2)
    })
  })

  describe('seed', () => {
    // A step's `run` own synchronous prefix (everything before its first internal await) runs as
    // part of the `new Database()` call inside mockDatabase(), before mockDatabase() has
    // returned -- so these tests use the `database` run() is passed as its own argument, not the
    // outer destructured `database`/`tasks`, which aren't assigned yet at that point.
    const seedWarnings = (spy) => spy.mock.calls.filter(([message]) => /seed/i.test(message))
    // testSchema is version 1; a couple of tests need a step targeting a later schema version
    // (simulating an app that migrated), which requires an actual higher-versioned schema --
    // Database validates that a seed step can't target a schema version the schema itself hasn't
    // reached.
    const schemaV2 = appSchema({ version: 2, tables: Object.values(testSchema.tables) })

    it('runs before any write()/read() issued after construction', async () => {
      const order = []
      const { database, tasks } = mockDatabase({
        seed: databaseSeed({
          steps: [
            {
              schemaVersion: 1,
              run: async (seedDb) => {
                order.push('run:start')
                await Promise.resolve()
                await seedDb.batch(seedDb.get('mock_tasks').prepareCreate())
                order.push('run:end')
              },
            },
          ],
        }),
      })

      await database.write(async () => {
        order.push('write')
      })

      expect(order).toEqual(['run:start', 'run:end', 'write'])
      expect(await tasks.query().fetchCount()).toBe(1)
    })

    it('queues a raw read (query().fetchCount()) issued before seed finishes', async () => {
      const order = []
      const { tasks } = mockDatabase({
        seed: databaseSeed({
          steps: [
            {
              schemaVersion: 1,
              run: async (seedDb) => {
                order.push('run:start')
                await Promise.resolve()
                await seedDb.batch(seedDb.get('mock_tasks').prepareCreate())
                order.push('run:end')
              },
            },
          ],
        }),
      })

      const count = await tasks.query().fetchCount()
      order.push('read')

      expect(order).toEqual(['run:start', 'run:end', 'read'])
      expect(count).toBe(1)
    })

    it('skips a step on a later construction once its schema version has already been applied', async () => {
      const runSpy = jest.fn(async (seedDb) => {
        await seedDb.batch(seedDb.get('mock_tasks').prepareCreate())
      })
      const { database, tasks } = mockDatabase({
        seed: databaseSeed({ steps: [{ schemaVersion: 1, run: runSpy }] }),
      })

      expect(await tasks.query().fetchCount()).toBe(1)
      expect(runSpy).toHaveBeenCalledTimes(1)

      // A later Database instance backed by the same underlying data (simulating a re-launch)
      const clonedAdapter = await database.adapter.underlyingAdapter.testClone({
        schema: testSchema,
      })
      const runSpy2 = jest.fn(async () => {})
      const database2 = new Database({
        adapter: clonedAdapter,
        modelClasses,
        seed: databaseSeed({ steps: [{ schemaVersion: 1, run: runSpy2 }] }),
      })

      expect(await database2.get('mock_tasks').query().fetchCount()).toBe(1)
      expect(runSpy2).not.toHaveBeenCalled()
    })

    it('runs multiple pending steps in ascending schema-version order, regardless of declaration order', async () => {
      const order = []
      const { tasks } = mockDatabase({
        schema: schemaV2,
        seed: databaseSeed({
          steps: [
            {
              schemaVersion: 2,
              run: async (seedDb) => {
                order.push('v2')
                await seedDb.batch(seedDb.get('mock_tasks').prepareCreate())
              },
            },
            {
              schemaVersion: 1,
              run: async (seedDb) => {
                order.push('v1')
                await seedDb.batch(seedDb.get('mock_tasks').prepareCreate())
              },
            },
          ],
        }),
      })

      expect(await tasks.query().fetchCount()).toBe(2)
      expect(order).toEqual(['v1', 'v2'])
    })

    it('applies only newly-pending steps on a later construction at a higher schema version', async () => {
      const { database, tasks } = mockDatabase({
        seed: databaseSeed({
          steps: [
            {
              schemaVersion: 1,
              run: async (seedDb) => {
                await seedDb.batch(seedDb.get('mock_tasks').prepareCreate())
              },
            },
          ],
        }),
      })
      expect(await tasks.query().fetchCount()).toBe(1)

      // A later Database instance at a higher schema version (simulating an app update that
      // migrated the schema and shipped a new seed step alongside it). A (no-op) migration is
      // required so the adapter upgrades in place instead of resetting on a version mismatch --
      // schemaV2 doesn't actually change any tables, so there's nothing for it to do.
      const clonedAdapter = await database.adapter.underlyingAdapter.testClone({
        schema: schemaV2,
        migrations: schemaMigrations({ migrations: [{ toVersion: 2, steps: [] }] }),
      })
      const step1Spy = jest.fn(async () => {})
      const step2Spy = jest.fn(async (seedDb) => {
        await seedDb.batch(seedDb.get('mock_tasks').prepareCreate())
      })
      const database2 = new Database({
        adapter: clonedAdapter,
        modelClasses,
        seed: databaseSeed({
          steps: [
            { schemaVersion: 1, run: step1Spy },
            { schemaVersion: 2, run: step2Spy },
          ],
        }),
      })

      expect(await database2.get('mock_tasks').query().fetchCount()).toBe(2)
      expect(step1Spy).not.toHaveBeenCalled()
      expect(step2Spy).toHaveBeenCalledTimes(1)
    })

    it("rejects (in dev) a seed step that targets a schema version the schema hasn't reached", () => {
      expect(() =>
        mockDatabase({
          seed: databaseSeed({ steps: [{ schemaVersion: 2, run: async () => {} }] }),
        }),
      ).toThrow(/schema version 2/)
    })

    it('lets run() read via the query API for some other reason without deadlocking', async () => {
      const { tasks } = mockDatabase({
        seed: databaseSeed({
          steps: [
            {
              schemaVersion: 1,
              run: async (seedDb) => {
                const seedTasks = seedDb.get('mock_tasks')
                const existingCount = await seedTasks.query().fetchCount()
                await seedDb.batch(seedTasks.prepareCreate(), seedTasks.prepareCreate())
                expect(existingCount).toBe(0)
              },
            },
          ],
        }),
      })

      expect(await tasks.query().fetchCount()).toBe(2)
    })

    it('supports database.batch() directly inside run() (not database.write(), which would deadlock)', async () => {
      const { tasks } = mockDatabase({
        seed: databaseSeed({
          steps: [
            {
              schemaVersion: 1,
              run: async (seedDb) => {
                const seedTasks = seedDb.get('mock_tasks')
                await seedDb.batch(seedTasks.prepareCreate(), seedTasks.prepareCreate())
              },
            },
          ],
        }),
      })

      expect(await tasks.query().fetchCount()).toBe(2)
    })

    it('reports a failing step via onError (with which schema version failed), and does not get stuck', async () => {
      const seedError = new Error('boom')
      const onError = jest.fn()
      const { tasks } = mockDatabase({
        seed: databaseSeed({
          steps: [
            {
              schemaVersion: 1,
              run: async () => {
                throw seedError
              },
            },
          ],
          onError,
        }),
      })

      // Reads still resolve -- the database becomes usable even though seeding failed
      expect(await tasks.query().fetchCount()).toBe(0)
      expect(onError).toHaveBeenCalledWith(seedError, { schemaVersion: 1 })
    })

    it('does not run a later step once an earlier one has failed', async () => {
      const step2Spy = jest.fn(async () => {})
      const { tasks } = mockDatabase({
        schema: schemaV2,
        seed: databaseSeed({
          steps: [
            {
              schemaVersion: 1,
              run: async () => {
                throw new Error('boom')
              },
            },
            { schemaVersion: 2, run: step2Spy },
          ],
          onError: () => {},
        }),
      })

      expect(await tasks.query().fetchCount()).toBe(0)
      expect(step2Spy).not.toHaveBeenCalled()
    })

    it('falls back to logger.error (in dev) when a step fails and no onError is given', async () => {
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {})
      const seedError = new Error('boom')
      const { tasks } = mockDatabase({
        seed: databaseSeed({
          steps: [
            {
              schemaVersion: 1,
              run: async () => {
                throw seedError
              },
            },
          ],
        }),
      })

      expect(await tasks.query().fetchCount()).toBe(0)
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('schema version 1'), seedError)
    })

    it('retries a failed step on the next launch (its version was not marked applied)', async () => {
      const { database } = mockDatabase({
        seed: databaseSeed({
          steps: [
            {
              schemaVersion: 1,
              run: async () => {
                throw new Error('boom')
              },
            },
          ],
          onError: () => {},
        }),
      })
      await database.get('mock_tasks').query().fetchCount() // wait for the seed attempt to settle

      const clonedAdapter = await database.adapter.underlyingAdapter.testClone({
        schema: testSchema,
      })
      const runSpy2 = jest.fn(async (seedDb) => {
        await seedDb.batch(seedDb.get('mock_tasks').prepareCreate())
      })
      const database2 = new Database({
        adapter: clonedAdapter,
        modelClasses,
        seed: databaseSeed({ steps: [{ schemaVersion: 1, run: runSpy2 }] }),
      })

      expect(await database2.get('mock_tasks').query().fetchCount()).toBe(1)
      expect(runSpy2).toHaveBeenCalledTimes(1)
    })

    it('warns once (in dev) when the database is accessed before seed finishes', async () => {
      const spy = jest.spyOn(logger, 'warn')
      let resolveRun
      // run() itself is only invoked after an async version-check (localStorage.get()) resolves,
      // so this signals when run() has actually started, separately from resolveRun (which lets
      // run() finish).
      let runStarted
      const runStartedPromise = new Promise((resolve) => {
        runStarted = resolve
      })
      const { tasks } = mockDatabase({
        seed: databaseSeed({
          steps: [
            {
              schemaVersion: 1,
              run: () => {
                runStarted()
                return new Promise((resolve) => {
                  resolveRun = resolve
                })
              },
            },
          ],
        }),
      })

      const fetch1 = tasks.query().fetchCount()
      expect(seedWarnings(spy)).toHaveLength(1)

      // A second early access is still queued correctly, but doesn't warn again
      const fetch2 = tasks.query().fetchCount()
      expect(seedWarnings(spy)).toHaveLength(1)

      await runStartedPromise
      resolveRun()
      expect(await fetch1).toBe(0)
      expect(await fetch2).toBe(0)
    })

    it('does not warn or wait on anything when no seed is configured', async () => {
      const spy = jest.spyOn(logger, 'warn')
      const { tasks } = mockDatabase()

      expect(await tasks.query().fetchCount()).toBe(0)
      expect(seedWarnings(spy)).toHaveLength(0)
    })

    describe('Database#readyPromise', () => {
      it('resolves once seed settles, even when no adapter initializingPromise exists', async () => {
        let resolveRun
        // run() is only invoked after an async version-check (localStorage.get()) resolves, so
        // this signals when run() has actually started, distinct from resolveRun (which lets it
        // finish) -- see the identical pattern in the "warns once" test above.
        let runStarted
        const runStartedPromise = new Promise((resolve) => {
          runStarted = resolve
        })
        const { database } = mockDatabase({
          seed: databaseSeed({
            steps: [
              {
                schemaVersion: 1,
                run: () => {
                  runStarted()
                  return new Promise((resolve) => {
                    resolveRun = resolve
                  })
                },
              },
            ],
          }),
        })

        let ready = false
        database.readyPromise.then(() => {
          ready = true
        })
        await runStartedPromise
        expect(ready).toBe(false)

        resolveRun()
        await database.readyPromise
        expect(ready).toBe(true)
      })

      it('resolves immediately when no seed is configured', async () => {
        const { database } = mockDatabase()
        await expect(database.readyPromise).resolves.toBeUndefined()
      })
    })
  })
})
