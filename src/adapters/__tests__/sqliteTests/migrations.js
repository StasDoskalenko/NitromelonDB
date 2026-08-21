/* eslint-disable jest/no-standalone-expect */
import { appSchema, tableSchema } from '../../../Schema'
import {
  schemaMigrations,
  createTable,
  addColumns,
  unsafeExecuteSql,
} from '../../../Schema/migrations'
import { taskQuery, projectQuery } from '../helpers'
import { createFileAdapter } from './helpers'

const tasksV1 = appSchema({
  version: 1,
  tables: [tableSchema({ name: 'tasks', columns: [{ name: 'num1', type: 'number' }] })],
})

const tasksTextV1 = appSchema({
  version: 1,
  tables: [tableSchema({ name: 'tasks', columns: [{ name: 'text1', type: 'string' }] })],
})

/**
 * Migration tests that require a file-backed database.
 */
export default (it) => {
  // M3: Migration on a file-backed database, then reopen: data preserved, migration not re-applied
  it('migrates file-backed database and preserves data across reopen', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform, { schema: tasksV1 })

    await adapter.batch([
      ['create', 'tasks', { id: 't1', num1: 42 }],
      ['create', 'tasks', { id: 't2', num1: 99 }],
    ])
    expect(await adapter.count(taskQuery())).toBe(2)

    const schemaV2 = appSchema({
      version: 2,
      tables: [
        tableSchema({
          name: 'tasks',
          columns: [
            { name: 'num1', type: 'number' },
            { name: 'test_string', type: 'string' },
            { name: 'test_number', type: 'number' },
          ],
        }),
      ],
    })
    const migrationsV2 = schemaMigrations({
      migrations: [
        {
          toVersion: 2,
          steps: [
            addColumns({
              table: 'tasks',
              columns: [
                { name: 'test_string', type: 'string' },
                { name: 'test_number', type: 'number' },
              ],
            }),
          ],
        },
      ],
    })

    const migratedAdapter = await adapter.testClone({
      schema: schemaV2,
      migrations: migrationsV2,
    })

    expect(await migratedAdapter.count(taskQuery())).toBe(2)
    const t1 = await migratedAdapter.find('tasks', 't1')
    expect(t1.test_string).toBe('')
    expect(t1.test_number).toBe(0)

    const reopenedAdapter = await migratedAdapter.testClone()
    expect(await reopenedAdapter.count(taskQuery())).toBe(2)
    const t1Reopened = await reopenedAdapter.find('tasks', 't1')
    expect(t1Reopened.test_string).toBe('')
  })

  // M4: unsafeExecuteSql step inside a migration
  it('unsafeExecuteSql migration step executes SQL', async (_adapter, AdapterClass, _extra, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform, { schema: tasksV1 })

    await adapter.batch([
      ['create', 'tasks', { id: 't1', num1: 1 }],
      ['create', 'tasks', { id: 't2', num1: 2 }],
    ])

    const schemaV2 = appSchema({
      version: 2,
      tables: [tableSchema({ name: 'tasks', columns: [{ name: 'num1', type: 'number' }] })],
    })
    const migrationsV2 = schemaMigrations({
      migrations: [
        {
          toVersion: 2,
          steps: [unsafeExecuteSql('UPDATE tasks SET num1 = num1 * 10 WHERE num1 = 1;')],
        },
      ],
    })

    const migratedAdapter = await adapter.testClone({
      schema: schemaV2,
      migrations: migrationsV2,
    })

    expect((await migratedAdapter.find('tasks', 't1')).num1).toBe(10)
    expect((await migratedAdapter.find('tasks', 't2')).num1).toBe(2)
  })

  // M5: addColumns with isIndexed: true — index exists
  it('addColumns with isIndexed creates an index', async (_adapter, AdapterClass, _extra, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform, { schema: tasksTextV1 })

    await adapter.batch([
      ['create', 'tasks', { id: 't1', text1: 'a' }],
      ['create', 'tasks', { id: 't2', text1: 'b' }],
    ])

    const schemaV2 = appSchema({
      version: 2,
      tables: [
        tableSchema({
          name: 'tasks',
          columns: [
            { name: 'text1', type: 'string' },
            { name: 'indexed_col', type: 'string', isIndexed: true },
          ],
        }),
      ],
    })
    const migrationsV2 = schemaMigrations({
      migrations: [
        {
          toVersion: 2,
          steps: [
            addColumns({
              table: 'tasks',
              columns: [{ name: 'indexed_col', type: 'string', isIndexed: true }],
            }),
          ],
        },
      ],
    })

    const migratedAdapter = await adapter.testClone({
      schema: schemaV2,
      migrations: migrationsV2,
    })

    expect(await migratedAdapter.count(taskQuery())).toBe(2)
    expect(await migratedAdapter.find('tasks', 't1')).not.toBeNull()
  })

  // M6: createTable in a migration, then write to and query the new table
  it('createTable in migration creates a usable table', async (_adapter, AdapterClass, _extra, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform, { schema: tasksTextV1 })

    await adapter.batch([['create', 'tasks', { id: 't1', text1: 'hello' }]])

    const schemaV2 = appSchema({
      version: 2,
      tables: [
        tableSchema({ name: 'tasks', columns: [{ name: 'text1', type: 'string' }] }),
        tableSchema({ name: 'projects', columns: [{ name: 'text1', type: 'string' }] }),
      ],
    })
    const migrationsV2 = schemaMigrations({
      migrations: [
        {
          toVersion: 2,
          steps: [createTable({ name: 'projects', columns: [{ name: 'text1', type: 'string' }] })],
        },
      ],
    })

    const migratedAdapter = await adapter.testClone({
      schema: schemaV2,
      migrations: migrationsV2,
    })

    await migratedAdapter.batch([['create', 'projects', { id: 'p1', text1: 'My Project' }]])
    expect(await migratedAdapter.queryIds(projectQuery())).toEqual(['p1'])

    const reopenedAdapter = await migratedAdapter.testClone()
    expect(await reopenedAdapter.queryIds(projectQuery())).toEqual(['p1'])
  })

  // M7: migrationEvents fire correctly
  it('migrationEvents fire exactly once for a migrating launch', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    let onStartFired = 0
    let onSuccessFired = 0
    let onErrorFired = 0

    const { adapter } = await createFileAdapter(platform, { schema: tasksTextV1 })
    await adapter.batch([['create', 'tasks', { id: 't1', text1: 'hello' }]])

    const schemaV2 = appSchema({
      version: 2,
      tables: [tableSchema({ name: 'tasks', columns: [{ name: 'text1', type: 'string' }] })],
    })
    const migrationsV2 = schemaMigrations({
      migrations: [{ toVersion: 2, steps: [] }],
    })

    await adapter.testClone({
      schema: schemaV2,
      migrations: migrationsV2,
      migrationEvents: {
        onStart: () => {
          onStartFired += 1
        },
        onSuccess: () => {
          onSuccessFired += 1
        },
        onError: () => {
          onErrorFired += 1
        },
      },
    })

    expect(onStartFired).toBe(1)
    expect(onSuccessFired).toBe(1)
    expect(onErrorFired).toBe(0)

    onStartFired = 0
    onSuccessFired = 0
    onErrorFired = 0

    await adapter.testClone({
      schema: schemaV2,
      migrations: migrationsV2,
      migrationEvents: {
        onStart: () => {
          onStartFired += 1
        },
        onSuccess: () => {
          onSuccessFired += 1
        },
        onError: () => {
          onErrorFired += 1
        },
      },
    })

    expect(onStartFired).toBe(0)
    expect(onSuccessFired).toBe(0)
    expect(onErrorFired).toBe(0)
  })

  // M8: migrationEvents.onError fires when a step fails
  it('migrationEvents.onError fires when migration step fails', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform, { schema: tasksTextV1 })

    const schemaV2 = appSchema({
      version: 2,
      tables: [tableSchema({ name: 'tasks', columns: [{ name: 'text1', type: 'string' }] })],
    })
    const migrationsV2 = schemaMigrations({
      migrations: [
        {
          toVersion: 2,
          // Duplicate table — SQLite fails the migration step
          steps: [createTable({ name: 'tasks', columns: [] })],
        },
      ],
    })

    let errorFired = false
    let successFired = false

    await expect(
      adapter.testClone({
        schema: schemaV2,
        migrations: migrationsV2,
        migrationEvents: {
          onStart: () => {},
          onSuccess: () => {
            successFired = true
          },
          onError: () => {
            errorFired = true
          },
        },
      }),
    ).rejects.toThrow()

    expect(errorFired).toBe(true)
    expect(successFired).toBe(false)
  })

  // M9: migration preserves many rows
  it('migration preserves 10k rows', async (_adapter, AdapterClass, _extra, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform, { schema: tasksV1 })

    const records = Array.from({ length: 10000 }, (_, i) => [
      'create',
      'tasks',
      { id: `t${i}`, num1: i },
    ])
    await adapter.batch(records)
    expect(await adapter.count(taskQuery())).toBe(10000)

    const schemaV2 = appSchema({
      version: 2,
      tables: [
        tableSchema({
          name: 'tasks',
          columns: [
            { name: 'num1', type: 'number' },
            { name: 'extra', type: 'string' },
          ],
        }),
      ],
    })
    const migrationsV2 = schemaMigrations({
      migrations: [
        {
          toVersion: 2,
          steps: [addColumns({ table: 'tasks', columns: [{ name: 'extra', type: 'string' }] })],
        },
      ],
    })

    const migratedAdapter = await adapter.testClone({
      schema: schemaV2,
      migrations: migrationsV2,
    })
    expect(await migratedAdapter.count(taskQuery())).toBe(10000)
    expect((await migratedAdapter.find('tasks', 't0')).num1).toBe(0)
    expect((await migratedAdapter.find('tasks', 't9999')).num1).toBe(9999)
  })

  // M10: failed migration does not leave a half-applied schema version
  it('migration interrupted mid-way is not left half-applied', async (
    _adapter,
    AdapterClass,
    _extra,
    platform,
  ) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const { adapter } = await createFileAdapter(platform, { schema: tasksV1 })
    await adapter.batch([['create', 'tasks', { id: 't1', num1: 1 }]])

    const schemaV3 = appSchema({
      version: 3,
      tables: [
        tableSchema({
          name: 'tasks',
          columns: [
            { name: 'num1', type: 'number' },
            { name: 'col_a', type: 'string' },
            { name: 'col_b', type: 'string' },
          ],
        }),
      ],
    })
    const migrationsV3 = schemaMigrations({
      migrations: [
        {
          toVersion: 2,
          steps: [addColumns({ table: 'tasks', columns: [{ name: 'col_a', type: 'string' }] })],
        },
        {
          toVersion: 3,
          steps: [createTable({ name: 'tasks', columns: [] })], // fails
        },
      ],
    })

    await expect(
      adapter.testClone({
        schema: schemaV3,
        migrations: migrationsV3,
      }),
    ).rejects.toThrow()

    // Reopen with original schema — still at v1, data intact
    const reopenedAdapter = await adapter.testClone({ schema: tasksV1 })
    expect(await reopenedAdapter.count(taskQuery())).toBe(1)
    expect((await reopenedAdapter.find('tasks', 't1')).num1).toBe(1)
  })
}
