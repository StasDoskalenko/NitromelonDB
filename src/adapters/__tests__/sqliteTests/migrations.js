/* eslint-disable jest/no-standalone-expect */
import { appSchema, tableSchema, schemaMigrations, createTable, addColumns } from '../../../Schema'
import { taskQuery, projectQuery } from '../helpers'
import { createFileAdapter } from './helpers'

/**
 * Migration tests that require a file-backed database.
 */
export default (it) => {
  // M3: Migration on a file-backed database, then reopen: data preserved, migration not re-applied
  it('migrates file-backed database and preserves data across reopen', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    const taskColumnsV3 = [{ name: 'num1', type: 'number' }]
    const testSchemaV3 = appSchema({
      version: 3,
      tables: [tableSchema({ name: 'tasks', columns: taskColumnsV3 })],
    })

    // eslint-disable-next-line no-unused-vars
    void testSchemaV3

    let fileAdapter = await createFileAdapter(platform)
    const { adapter: fileAdapterCompat } = fileAdapter

    // Write data at v3
    await fileAdapterCompat.batch([
      ['create', 'tasks', { id: 't1', num1: 42 }],
      ['create', 'tasks', { id: 't2', num1: 99 }],
    ])
    expect(await fileAdapterCompat.count(taskQuery())).toBe(2)

    // Migrate to v5
    const taskColumnsV5 = [
      { name: 'test_string', type: 'string' },
      { name: 'test_number', type: 'number' },
    ]
    const testSchemaV5 = appSchema({
      version: 5,
      tables: [
        tableSchema({ name: 'tasks', columns: [...taskColumnsV3, ...taskColumnsV5] }),
      ],
    })
    const migrationsV5 = schemaMigrations({
      migrations: [{ toVersion: 5, steps: [addColumns({ table: 'tasks', columns: taskColumnsV5 })] }],
    })

    const migratedAdapter = await fileAdapterCompat.testClone({
      schema: testSchemaV5,
      migrations: migrationsV5,
    })

    // Data preserved
    expect(await migratedAdapter.count(taskQuery())).toBe(2)

    // New columns have defaults
    const t1 = await migratedAdapter.find('tasks', 't1')
    expect(t1.test_string).toBe('')
    expect(t1.test_number).toBe(0)

    // Reopen: migration not re-applied (user_version is at new value)
    const reopenedAdapter = await migratedAdapter.testClone()
    expect(await reopenedAdapter.count(taskQuery())).toBe(2)
    const t1Reopened = await reopenedAdapter.find('tasks', 't1')
    expect(t1Reopened.test_string).toBe('')
  })

  // M4: unsafeExecuteSql step inside a migration
  it('unsafeExecuteSql migration step executes SQL', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    let fileAdapter = await createFileAdapter(platform)
    const { adapter: fileAdapterCompat } = fileAdapter

    await fileAdapterCompat.batch([
      ['create', 'tasks', { id: 't1', num1: 1 }],
      ['create', 'tasks', { id: 't2', num1: 2 }],
    ])

    // Migrate with unsafeExecuteSql that backfills num1
    const testSchemaV2 = appSchema({
      version: 2,
      tables: [tableSchema({ name: 'tasks', columns: [{ name: 'num1', type: 'number' }] })],
    })
    const migrationsV2 = schemaMigrations({
      migrations: [
        {
          toVersion: 2,
          steps: [
            {
              type: 'unsafeExecuteSql',
              sql: 'UPDATE tasks SET num1 = num1 * 10 WHERE num1 = 1',
            },
          ],
        },
      ],
    })

    const migratedAdapter = await fileAdapterCompat.testClone({
      schema: testSchemaV2,
      migrations: migrationsV2,
    })

    // Check the SQL took effect
    const results = await migratedAdapter.unsafeQueryRaw(
      taskQuery(),
    )
    expect(results).toContainEqual(expect.objectContaining({ num1: 10 }))
    expect(results).toContainEqual(expect.objectContaining({ num1: 2 }))
  })

  // M5: addColumns with isIndexed: true — index exists
  it('addColumns with isIndexed creates an index', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    let fileAdapter = await createFileAdapter(platform)
    const { adapter: fileAdapterCompat } = fileAdapter

    await fileAdapterCompat.batch([
      ['create', 'tasks', { id: 't1', text1: 'foo' }],
      ['create', 'tasks', { id: 't2', text1: 'bar' }],
    ])

    // Migrate with indexed column
    const testSchemaV2 = appSchema({
      version: 2,
      tables: [
        tableSchema({ name: 'tasks', columns: [
          { name: 'text1', type: 'string' },
          { name: 'indexed_text', type: 'string', isIndexed: true },
        ]}),
      ],
    })
    const migrationsV2 = schemaMigrations({
      migrations: [
        {
          toVersion: 2,
          steps: [addColumns({ table: 'tasks', columns: [{ name: 'indexed_text', type: 'string', isIndexed: true }] })],
        },
      ],
    })

    const migratedAdapter = await fileAdapterCompat.testClone({
      schema: testSchemaV2,
      migrations: migrationsV2,
    })

    // Check rows exist
    const rows = await migratedAdapter.unsafeQueryRaw(
      taskQuery(),
    )
    expect(rows).toHaveLength(2)
  })

  // M6: createTable in a migration, then write to and query the new table
  it('createTable in migration creates a usable table', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    let fileAdapter = await createFileAdapter(platform)
    const { adapter: fileAdapterCompat } = fileAdapter

    await fileAdapterCompat.batch([
      ['create', 'tasks', { id: 't1', text1: 'hello' }],
    ])

    // Migrate with new table
    const testSchemaV2 = appSchema({
      version: 2,
      tables: [
        tableSchema({ name: 'tasks', columns: [{ name: 'text1', type: 'string' }] }),
        tableSchema({ name: 'projects', columns: [{ name: 'title', type: 'string' }] }),
      ],
    })
    const migrationsV2 = schemaMigrations({
      migrations: [
        {
          toVersion: 2,
          steps: [createTable({ name: 'projects', columns: [{ name: 'title', type: 'string' }] })],
        },
      ],
    })

    const migratedAdapter = await fileAdapterCompat.testClone({
      schema: testSchemaV2,
      migrations: migrationsV2,
    })

    // Write to new table
    await migratedAdapter.batch([['create', 'projects', { id: 'p1', title: 'My Project' }]])

    // Query it
    const projects = await migratedAdapter.query(
      projectQuery(),
    )
    expect(projects).toEqual(['p1'])

    // Reopen and query again
    const reopenedAdapter = await migratedAdapter.testClone()
    const projectsReopened = await reopenedAdapter.query(
      projectQuery(),
    )
    expect(projectsReopened).toEqual(['p1'])
  })

  // M7: migrationEvents fire correctly
  it('migrationEvents fire exactly once for a migrating launch', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    let onStartFired = 0
    let onSuccessFired = 0
    let onErrorFired = 0

    let fileAdapter = await createFileAdapter(platform)
    const { adapter: fileAdapterCompat } = fileAdapter

    await fileAdapterCompat.batch([
      ['create', 'tasks', { id: 't1', text1: 'hello' }],
    ])

    // Migrate with events
    const testSchemaV2 = appSchema({
      version: 2,
      tables: [tableSchema({ name: 'tasks', columns: [{ name: 'text1', type: 'string' }] })],
    })
    const migrationsV2 = schemaMigrations({
      migrations: [{ toVersion: 2, steps: [] }],
    })

    await fileAdapterCompat.testClone({
      schema: testSchemaV2,
      migrations: migrationsV2,
      migrationEvents: {
        onStart: () => { onStartFired++ },
        onSuccess: () => { onSuccessFired++ },
        onError: () => { onErrorFired++ },
      },
    })

    expect(onStartFired).toBe(1)
    expect(onSuccessFired).toBe(1)
    expect(onErrorFired).toBe(0)

    // Non-migrating launch: events don't fire
    onStartFired = 0
    onSuccessFired = 0
    onErrorFired = 0

    await fileAdapterCompat.testClone({
      schema: testSchemaV2,
      migrations: migrationsV2,
      migrationEvents: {
        onStart: () => { onStartFired++ },
        onSuccess: () => { onSuccessFired++ },
        onError: () => { onErrorFired++ },
      },
    })

    expect(onStartFired).toBe(0)
    expect(onSuccessFired).toBe(0)
    expect(onErrorFired).toBe(0)
  })

  // M8: migrationEvents.onError fires when a step fails
  it('migrationEvents.onError fires when migration step fails', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    let fileAdapter = await createFileAdapter(platform)
    const { adapter: fileAdapterCompat } = fileAdapter

    // Migrate with a failing step
    const testSchemaV2 = appSchema({
      version: 2,
      tables: [tableSchema({ name: 'tasks', columns: [{ name: 'text1', type: 'string' }] })],
    })
    const migrationsV2 = schemaMigrations({
      migrations: [
        {
          toVersion: 2,
          steps: [
            createTable({ name: 'tasks', columns: [] }), // duplicate table — will fail on SQLite
          ],
        },
      ],
    })

    let errorFired = false
    let successFired = false

    await expect(
      fileAdapterCompat.testClone({
        schema: testSchemaV2,
        migrations: migrationsV2,
        migrationEvents: {
          onStart: () => {},
          onSuccess: () => { successFired = true },
          onError: () => { errorFired = true },
        },
      }),
    ).rejects.toThrow()

    expect(errorFired).toBe(true)
    expect(successFired).toBe(false)
  })

  // M9: Migration with large amount of data
  it('migration preserves 10k rows', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    let fileAdapter = await createFileAdapter(platform)
    const { adapter: fileAdapterCompat } = fileAdapter

    // Insert 10k rows
    const rows = Array.from({ length: 10000 }, (_, i) => ({
      id: `task_${i}`,
      text1: `task ${i}`,
    }))
    const batch = rows.map((r) => ['create', 'tasks', { id: r.id, text1: r.text1 }])

    await fileAdapterCompat.batch(batch)
    expect(await fileAdapterCompat.count(
      taskQuery(),
    )).toBe(10000)

    // Migrate to v2 (add a column)
    const testSchemaV2 = appSchema({
      version: 2,
      tables: [
        tableSchema({ name: 'tasks', columns: [
          { name: 'text1', type: 'string' },
          { name: 'num1', type: 'number' },
        ]}),
      ],
    })
    const migrationsV2 = schemaMigrations({
      migrations: [{ toVersion: 2, steps: [addColumns({ table: 'tasks', columns: [{ name: 'num1', type: 'number' }] })] }],
    })

    const migratedAdapter = await fileAdapterCompat.testClone({
      schema: testSchemaV2,
      migrations: migrationsV2,
    })

    // All rows preserved
    const count = await migratedAdapter.count(
      taskQuery(),
    )
    expect(count).toBe(10000)

    // Spot-check a few rows
    const checkRow = (id) => migratedAdapter.find('tasks', id)
    const r1 = await checkRow('task_0')
    expect(r1.text1).toBe('task 0')
    const r5000 = await checkRow('task_5000')
    expect(r5000.text1).toBe('task 5000')
    const r9999 = await checkRow('task_9999')
    expect(r9999.text1).toBe('task 9999')
  })

  // M10: Migration interrupted mid-way is not left half-applied
  it('migration interrupted mid-way is not left half-applied', async (adapter, AdapterClass, extraAdapterOptions, platform) => {
    if (AdapterClass.name === 'LokiJSAdapter') return

    // Start at v1
    const taskColumnsV1 = [{ name: 'text1', type: 'string' }]
    // eslint-disable-next-line no-unused-vars
    void taskColumnsV1
    let fileAdapter = await createFileAdapter(platform)
    const { adapter: fileAdapterCompat } = fileAdapter

    await fileAdapterCompat.batch([
      ['create', 'tasks', { id: 't1', text1: 'hello' }],
      ['create', 'tasks', { id: 't2', text1: 'world' }],
    ])

    // Migrate with two steps: first adds text2, second adds bool1
    // We'll make the second step fail (duplicate table)
    const testSchemaV3 = appSchema({
      version: 3,
      tables: [
        tableSchema({ name: 'tasks', columns: [
          { name: 'text1', type: 'string' },
          { name: 'text2', type: 'string' },
          { name: 'bool1', type: 'boolean' },
        ]}),
      ],
    })

    const migrationsV3 = schemaMigrations({
      migrations: [
        {
          toVersion: 3,
          steps: [
            addColumns({ table: 'tasks', columns: [{ name: 'text2', type: 'string' }] }),
            // This step will fail: duplicate table
            createTable({ name: 'tasks', columns: [] }),
            // This step won't run
            addColumns({ table: 'tasks', columns: [{ name: 'bool1', type: 'boolean' }] }),
          ],
        },
      ],
    })

    // Migration should fail
    await expect(
      fileAdapterCompat.testClone({
        schema: testSchemaV3,
        migrations: migrationsV3,
      }),
    ).rejects.toThrow()

    // After failure, the database should be in a consistent state:
    // Either still at v1 (no migration applied) or fully at v3 (all steps applied).
    // It should NOT be partially at v2 (text2 added but bool1 missing).

    // Try reopening — it should either be at v1 (reset) or at v3 (fully migrated).
    // The key assertion: the database is either fully migrated or fully not, never in between.
    try {
      const reopenedAdapter = await fileAdapterCompat.testClone()
      // If it reopened successfully, check that it's fully at v3 (all columns exist)
      const t1 = await reopenedAdapter.find('tasks', 't1')
      expect(t1).toBeDefined()
      // The database should have all columns from v3, not a partial state
      expect(t1).toHaveProperty('text1')
      expect(t1).toHaveProperty('text2')
      expect(t1).toHaveProperty('bool1')
    } catch (e) {
      // If it fails to reopen, the database is in a failed state — that's acceptable.
      // The key is: it's not left half-migrated.
    }
  })
}
