import { MockTask, mockDatabase, testSchema } from '../../__tests__/testModels'
import { logger } from '../../utils/common'
import Collection from '../../Collection'
import Database from '../../Database'
import LokiJSAdapter from '../../adapters/lokijs'
import action, { writer, reader } from './index'

class MockTaskExtended extends MockTask {
  @reader
  async returnArgs(a, b, ...c) {
    return [this.name, a, b, c]
  }

  @writer
  async nested(...args) {
    this.callWriter(() => this.returnArgs('sub', ...args))
    this.callWriter(() => this.db.write(async () => 42))

    return this.callReader(() => this.returnArgs('sub', ...args))
  }
}

describe('@action', () => {
  it('is a deprecated alias of @writer', async () => {
    const { database, tasks } = mockDatabase()
    class MockTaskWithAction extends MockTask {
      @action
      async returnArgs(a, b) {
        return [this.name, a, b]
      }
    }
    const record = new MockTaskWithAction(tasks, { name: 'test' })
    const writeSpy = jest.spyOn(database, 'write')
    const warnSpy = jest.spyOn(logger, 'warn')

    expect(await record.returnArgs(1, 2)).toEqual(['test', 1, 2])
    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(writeSpy.mock.calls[0][1]).toBe('mock_tasks.returnArgs (legacy action)')

    // Warns about @action itself (once), not about Database.action(), which the user never called
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toMatch(/^DEPRECATION: @action is deprecated\. Use @writer instead\./)
    await record.returnArgs(3, 4)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })
})

describe('@writer', () => {
  it('calls db.writer() and passes arguments correctly', async () => {
    const { database, tasks } = mockDatabase()
    const record = new MockTaskExtended(tasks, { name: 'test' })

    const spy = jest.spyOn(database, 'read')

    expect(await record.returnArgs(1, 2, 3, 4)).toEqual(['test', 1, 2, [3, 4]])

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBeInstanceOf(Function)
    expect(spy.mock.calls[0][1]).toBe('mock_tasks.returnArgs')
  })
  it('can call subactions using this.callReader/callWriter', async () => {
    const { tasks } = mockDatabase()
    const record = new MockTaskExtended(tasks, { name: 'test' })

    expect(await record.nested(1, 2, 3, 4)).toEqual(['test', 'sub', 1, [2, 3, 4]])
  })
  it('works with arbitrary classes', async () => {
    const { database } = mockDatabase()
    const spy = jest.spyOn(database, 'read')
    class TestClass {
      database

      @reader async test() {
        return 42
      }
    }

    const test = new TestClass()
    test.database = database

    expect(await test.test()).toEqual(42)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('decorated Collection subclass methods', () => {
  // Decorators receive the bare prototype. Collection's `table` getter reads
  // `this.modelClass`, which only the constructor sets, so anything that reads
  // `table` at decoration time throws when the class is defined (#84).
  const makeDatabase = () => {
    class TaskCollection extends Collection {
      @writer
      async createNamed(name) {
        return this.create((task) => {
          task.name = name
        })
      }

      @reader
      async countAll() {
        return this.query().fetchCount()
      }

      @action
      async createNamedLegacy(name) {
        return this.create((task) => {
          task.name = name
        })
      }

      completeAll() {
        return this.database.write(async (writer) => {
          const tasks = await this.query().fetch()
          for (const task of tasks) {
            await writer.callWriter(() => task.complete())
          }
        }, 'mock_tasks.completeAll')
      }
    }
    class TaskWithCollection extends MockTask {
      static associatedCollectionClass = TaskCollection

      @writer
      async complete() {
        await this.update((task) => {
          task.isCompleted = true
        })
      }
    }

    const adapter = new LokiJSAdapter({
      dbName: 'test',
      schema: testSchema,
      useWebWorker: false,
      useIncrementalIndexedDB: false,
    })
    const database = new Database({
      adapter,
      schema: testSchema,
      modelClasses: [TaskWithCollection],
    })
    return { database, tasks: database.get('mock_tasks'), TaskCollection }
  }

  it('is used as the table\'s collection', () => {
    const { tasks, TaskCollection } = makeDatabase()
    expect(tasks).toBeInstanceOf(TaskCollection)
  })
  it('wraps @writer and @reader methods using the table name', async () => {
    const { database, tasks } = makeDatabase()
    const writeSpy = jest.spyOn(database, 'write')
    const readSpy = jest.spyOn(database, 'read')

    const task = await tasks.createNamed('hello')
    expect(task.name).toBe('hello')
    expect(await tasks.countAll()).toBe(1)

    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(writeSpy.mock.calls[0][1]).toBe('mock_tasks.createNamed')
    expect(readSpy).toHaveBeenCalledTimes(1)
    expect(readSpy.mock.calls[0][1]).toBe('mock_tasks.countAll')
  })
  it('wraps deprecated @action methods using the table name', async () => {
    const { database, tasks } = makeDatabase()
    const spy = jest.spyOn(database, 'write')

    const task = await tasks.createNamedLegacy('legacy')
    expect(task.name).toBe('legacy')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toBe('mock_tasks.createNamedLegacy (legacy action)')
  })
  it('can call record @writer methods through database.write()', async () => {
    const { tasks } = makeDatabase()
    await tasks.createNamed('a')
    await tasks.createNamed('b')

    await tasks.completeAll()

    const all = await tasks.query().fetch()
    expect(all.map((task) => task.isCompleted)).toEqual([true, true])
  })
})
