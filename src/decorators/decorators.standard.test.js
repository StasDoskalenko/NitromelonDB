// Compiled with standard (TC39 2023-11) decorators, see babel.config.js. The library itself is
// still compiled with legacy decorators, as in a published build.
import { testSchema } from '../__tests__/testModels'
import Model from '../Model'
import Database from '../Database'
import LokiJSAdapter from '../adapters/lokijs'
import logger from '../utils/common/logger'
import {
  field,
  text,
  date,
  json,
  relation,
  immutableRelation,
  children,
  readonly,
  nochange,
  lazy,
  writer,
  reader,
  action,
  experimentalFailsafe,
} from './index'

const sanitizeTags = (raw) => (Array.isArray(raw) ? raw.map(String) : [])

class Project extends Model {
  static table = 'mock_projects'

  static associations = {
    mock_tasks: { type: 'has_many', foreignKey: 'project_id' },
  }

  @field('name') accessor name

  @children('mock_tasks') accessor tasks

  @lazy get completedTasks() {
    lazyEvaluations += 1
    return this.tasks.extend()
  }

  @writer async rename(name) {
    await this.update((project) => {
      project.name = name
    })
    return this.name
  }

  @reader async countTasks() {
    return this.tasks.fetchCount()
  }

  @action async legacyRename(name) {
    await this.update((project) => {
      project.name = name
    })
  }
}
let lazyEvaluations = 0

class Task extends Model {
  static table = 'mock_tasks'

  static associations = {
    mock_projects: { type: 'belongs_to', key: 'project_id' },
  }

  @text('name') accessor name

  @field('position') accessor position

  @nochange @field('project_id') accessor projectId

  @json('description', sanitizeTags) accessor tags

  @relation('mock_projects', 'project_id') accessor project
}

class Comment extends Model {
  static table = 'mock_comments'

  @immutableRelation('mock_tasks', 'task_id') accessor task

  @text('body') accessor body

  @readonly @date('created_at') accessor createdAt
}

// Same models without `accessor`: the fallback for models that haven't been migrated yet
class PlainProject extends Model {
  static table = 'mock_projects'

  @field('name') name
}

class PlainTask extends Model {
  static table = 'mock_tasks'

  @text('name') name

  @nochange @field('project_id') projectId

  @relation('mock_projects', 'project_id') project
}

class PlainComment extends Model {
  static table = 'mock_comments'

  @text('body') body

  @readonly @date('created_at') createdAt
}

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

describe('standard decorators, accessor fields', () => {
  it('reads and writes model fields through the raw record', async () => {
    const db = makeDatabase([Project, Task, Comment])
    const project = await db.write(() =>
      db.get('mock_projects').create((p) => {
        p.name = 'Inbox'
      }),
    )
    const task = await db.write(() =>
      db.get('mock_tasks').create((t) => {
        t.name = '  Buy milk  '
        t.position = 3
        t.projectId = project.id
        t.tags = ['a', 1]
      }),
    )

    expect(project.name).toBe('Inbox')
    expect(project._raw.name).toBe('Inbox')
    expect(task.name).toBe('Buy milk')
    expect(task._raw.name).toBe('Buy milk')
    expect(task.position).toBe(3)
    expect(task.tags).toEqual(['a', '1'])
    expect(task._raw.description).toBe('["a","1"]')

    // Prototype getters/setters, not own instance properties
    expect(Object.getOwnPropertyNames(task)).not.toContain('name')
    expect(Object.getOwnPropertyNames(Task.prototype)).toEqual(
      expect.arrayContaining(['name', 'position', 'projectId', 'tags', 'project']),
    )

    // Change tracking still sees accessor writes
    await db.write(() =>
      task.update((t) => {
        t.position = 4
      }),
    )
    expect(task._raw._changed).toContain('position')
  })

  it('supports relations, children, @nochange and @readonly', async () => {
    const db = makeDatabase([Project, Task, Comment])
    const project = await db.write(() =>
      db.get('mock_projects').create((p) => {
        p.name = 'Work'
      }),
    )
    const task = await db.write(() =>
      db.get('mock_tasks').create((t) => {
        t.projectId = project.id
      }),
    )
    const comment = await db.write(() =>
      db.get('mock_comments').create((c) => {
        c._raw.task_id = task.id
        c.body = 'hi'
      }),
    )

    expect(task.project.id).toBe(project.id)
    expect(await task.project.fetch()).toBe(project)
    expect(task.project).toBe(task.project) // cached per record
    expect(() => {
      task.project = project
    }).toThrow('relation.set()')
    expect(await comment.task.fetch()).toBe(task)
    expect(await project.tasks.fetchCount()).toBe(1)

    await expect(
      db.write(() =>
        task.update((t) => {
          t.projectId = 'other'
        }),
      ),
    ).rejects.toThrow('@nochange field: projectId')

    expect(comment.createdAt).toBeInstanceOf(Date)
    expect(() => {
      comment.createdAt = new Date()
    }).toThrow('createdAt marked as @readonly')
  })

  it('wraps @writer, @reader and @action methods', async () => {
    const db = makeDatabase([Project, Task, Comment])
    const project = await db.write(() =>
      db.get('mock_projects').create((p) => {
        p.name = 'Old'
      }),
    )

    // Outside of db.write(): the method opens its own writer
    expect(await project.rename('New')).toBe('New')
    expect(await project.countTasks()).toBe(0)

    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
    await project.legacyRename('Legacy')
    expect(project.name).toBe('Legacy')
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^DEPRECATION: @action/))
  })

  it('computes @lazy getters once per record', async () => {
    const db = makeDatabase([Project, Task, Comment])
    const [a, b] = await db.write(() =>
      Promise.all([
        db.get('mock_projects').create(() => {}),
        db.get('mock_projects').create(() => {}),
      ]),
    )
    lazyEvaluations = 0
    expect(a.completedTasks).toBe(a.completedTasks)
    expect(lazyEvaluations).toBe(1)
    expect(b.completedTasks).not.toBe(a.completedTasks)
    expect(lazyEvaluations).toBe(2)
    // Reading it off the prototype doesn't cache anything there
    expect(Object.getOwnPropertyDescriptor(Project.prototype, 'completedTasks').get).toEqual(
      expect.any(Function),
    )
  })
})

describe('standard decorators, plain fields (fallback)', () => {
  it('keeps unmigrated models working, with a dev warning', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
    class Fallback {
      asModel = { _getRaw: (c) => this.raw[c] ?? null, _setRaw: (c, v) => (this.raw[c] = v) }

      raw = {}

      @field('a_column') fallbackField
    }
    const instance = new Fallback()
    instance.fallbackField = 1
    expect(instance.raw.a_column).toBe(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '@field on "fallbackField": with standard decorators, declare it as `accessor fallbackField`',
      ),
    )

    // Once per decorator and property name
    warn.mockClear()
    class Fallback2 {
      @field('a_column') fallbackField
    }
    expect(Fallback2).toBeDefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it('reads and writes through the raw record, with relations, @nochange and @readonly', async () => {
    jest.spyOn(logger, 'warn').mockImplementation(() => {})
    const db = makeDatabase([PlainProject, PlainTask, PlainComment])
    const project = await db.write(() =>
      db.get('mock_projects').create((p) => {
        p.name = 'Inbox'
      }),
    )
    const task = await db.write(() =>
      db.get('mock_tasks').create((t) => {
        t.name = ' x '
        t.projectId = project.id
      }),
    )
    const comment = await db.write(() =>
      db.get('mock_comments').create((c) => {
        c.body = 'hi'
      }),
    )

    expect(project.name).toBe('Inbox')
    expect(project._raw.name).toBe('Inbox')
    expect(task.name).toBe('x')
    expect(await task.project.fetch()).toBe(project)
    // Fallback getters/setters live on the instance
    expect(Object.getOwnPropertyNames(task)).toContain('name')

    await expect(
      db.write(() =>
        task.update((t) => {
          t.projectId = 'other'
        }),
      ),
    ).rejects.toThrow('@nochange field: projectId')
    expect(() => {
      comment.createdAt = new Date()
    }).toThrow('createdAt marked as @readonly')
  })

  it('makes simple @readonly fields non-writable', () => {
    class Config {
      @readonly version = 2
    }
    const config = new Config()
    expect(config.version).toBe(2)
    expect(() => {
      config.version = 3
    }).toThrow(TypeError)
  })

  it('evaluates @lazy fields eagerly, once, with a dev warning', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
    let made = 0
    class X {
      @lazy foo = { id: ++made }
    }
    const x = new X()
    expect(made).toBe(1)
    expect(x.foo).toBe(x.foo)
    expect(made).toBe(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('use a getter: `@lazy get foo()'))
  })
})

describe('standard decorators, misuse', () => {
  it('needs a column name', () => {
    expect(
      () =>
        class {
          @field accessor noName
        },
    ).toThrow('column name')
    expect(
      () =>
        class {
          @field() accessor noName
        },
    ).toThrow('column name')
  })

  it('rejects default values when a record is built', () => {
    class WithDefault {
      @field('x') accessor x = 'hey'
    }
    expect(() => new WithDefault()).toThrow('properties with a default value')
  })

  it('rejects methods, getters, statics and private fields', () => {
    expect(
      () =>
        class {
          @field('x') method() {}
        },
    ).toThrow('simple properties - method "method" given')
    expect(
      () =>
        class {
          @field('x') get getter() {
            return 1
          }
        },
    ).toThrow('simple properties - getter "getter" given')
    expect(
      () =>
        class {
          @field('x') static accessor y
        },
    ).toThrow("can't be used on static properties")
    expect(
      () =>
        class {
          @field('x') accessor #z
        },
    ).toThrow("can't be used on private (#) properties")
    expect(
      () =>
        class {
          @writer notAMethod
        },
    ).toThrow('@writer can only be used on methods - field "notAMethod" given')
    expect(
      () =>
        class {
          @nochange method() {}
        },
    ).toThrow("@nochange can't be used on a method")
    expect(
      () =>
        class {
          @experimentalFailsafe() get x() {
            return 1
          }
        },
    ).toThrow('only supports legacy decorators')
  })
})
