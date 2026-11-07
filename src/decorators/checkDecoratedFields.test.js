import ts from 'typescript'

import { testSchema, MockTask, MockProjectSection, MockComment } from '../__tests__/testModels'
import Model from '../Model'
import Database from '../Database'
import LokiJSAdapter from '../adapters/lokijs'
import logger from '../utils/common/logger'
import * as decorators from './index'

const makeDatabase = (modelClasses) =>
  new Database({
    adapter: new LokiJSAdapter({
      dbName: 'test',
      schema: testSchema,
      useWebWorker: false,
      useIncrementalIndexedDB: false,
    }),
    schema: testSchema,
    modelClasses,
  })

// Compiles a model with TypeScript itself (legacy `experimentalDecorators`), the way tsc,
// ts-node or ts-jest would, and returns its class
const compileWithTypeScript = (source, compilerOptions) => {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      experimentalDecorators: true,
      module: ts.ModuleKind.CommonJS,
      ...compilerOptions,
    },
  })
  const module = { exports: {} }
  const fakeRequire = (name) => {
    if (name === 'nitromelondb') return { Model }
    if (name === 'nitromelondb/decorators') return decorators
    throw new Error(`unexpected import ${name}`)
  }
  new Function('require', 'module', 'exports', outputText)(fakeRequire, module, module.exports)
  return module.exports.default
}

const projectModelSource = `
import { Model } from 'nitromelondb'
import { field } from 'nitromelondb/decorators'

export default class TsProject extends Model {
  static table = 'mock_projects'
  @field('name') name!: string
}
`

describe('checkDecoratedFields', () => {
  it("doesn't warn for correctly compiled models", async () => {
    const error = jest.spyOn(logger, 'error')
    const db = makeDatabase([MockTask, MockProjectSection, MockComment])
    await db.write(async () => {
      await db.get('mock_tasks').create((task) => {
        task.name = 'a'
      })
      await db.get('mock_comments').create(() => {})
    })
    expect(error).not.toHaveBeenCalled()
  })

  it('warns when TypeScript defines class fields on each instance (useDefineForClassFields)', async () => {
    const error = jest.spyOn(logger, 'error').mockImplementation(() => {})
    const TsProject = compileWithTypeScript(projectModelSource, {
      target: ts.ScriptTarget.ES2022, // useDefineForClassFields defaults to true
    })
    const db = makeDatabase([TsProject, MockTask])
    const project = await db.write(() =>
      db.get('mock_projects').create((p) => {
        p.name = 'Inbox'
      }),
    )

    // The bug being reported: the write went to the instance, not the database
    expect(project._raw.name).toBe('')
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toMatch(
      /^TsProject: decorators aren't working for name \(@field\)\. .*useDefineForClassFields/,
    )

    // Once per class
    await db.write(() => db.get('mock_projects').create(() => {}))
    expect(error).toHaveBeenCalledTimes(1)
  })

  it("doesn't warn, and works, with useDefineForClassFields off", async () => {
    const error = jest.spyOn(logger, 'error')
    const TsProject = compileWithTypeScript(projectModelSource, {
      target: ts.ScriptTarget.ES2022,
      useDefineForClassFields: false,
    })
    const db = makeDatabase([TsProject, MockTask])
    const project = await db.write(() =>
      db.get('mock_projects').create((p) => {
        p.name = 'Inbox'
      }),
    )
    expect(project._raw.name).toBe('Inbox')
    expect(project.name).toBe('Inbox')
    expect(error).not.toHaveBeenCalled()
  })

  it('warns for fetched records too, with a Babel hint when Babel compiled the class', async () => {
    const error = jest.spyOn(logger, 'error').mockImplementation(() => {})

    // Simulates a Babel setup that defines the field on each instance after the legacy decorator
    // ran (Babel passes a descriptor, unlike TypeScript)
    class BrokenTask extends Model {
      static table = 'mock_tasks'

      constructor(...args) {
        super(...args)
        Object.defineProperty(this, 'name', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: undefined,
        })
      }
    }
    Object.defineProperty(
      BrokenTask.prototype,
      'name',
      decorators.field('name')(BrokenTask.prototype, 'name', { initializer: undefined }),
    )
    // Save with a working model, then reopen the database (like an app restart) with the broken
    // one, so fetching builds the record from the raw row
    const db = makeDatabase([MockTask])
    await db.write(() =>
      db.get('mock_tasks').create((t) => {
        t.name = 'saved'
      }),
    )
    const reopened = new Database({
      adapter: await db.adapter.underlyingAdapter.testClone({ schema: testSchema }),
      schema: testSchema,
      modelClasses: [BrokenTask],
    })
    const [task] = await reopened.get('mock_tasks').query().fetch()

    expect(task._raw.name).toBe('saved')
    expect(task.name).toBe(undefined)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toMatch(
      /^BrokenTask: decorators aren't working for name \(@field\)\. .*Babel compiled these class fields/,
    )
  })
})
