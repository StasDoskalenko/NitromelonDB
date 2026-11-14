import { logger } from '../../../utils/common'
import { ADAPTERS, expectConverged, makeClient, schemaV1, setUpServer } from './helpers'

const server = setUpServer()

describe.each(ADAPTERS)('Migration syncs end-to-end (%s)', (adapterKind) => {
  it('pulls the values of a column the app adds in a migration', async () => {
    // The server already has tasks.priority (added in app schema version 2)
    await server.write('tasks', {
      upsert: [
        { id: 'importanttask01', name: 'Important', priority: 3 },
        { id: 'regulartask0001', name: 'Regular', priority: 0 },
      ],
    })

    // A device still on version 1 doesn't know about priority yet
    const oldApp = makeClient(server, adapterKind, { schema: schemaV1 })
    await oldApp.sync()
    const [importantOnOldApp] = await oldApp.tasks.query().fetch()
    expect(importantOnOldApp._raw.priority).toBe(undefined)

    // It edits a task and pushes it without priority. The server must not reset priority to 0.
    await oldApp.write(() => importantOnOldApp.update((t) => (t.name = 'Important (edited on v1)')))
    await oldApp.sync()
    expect((await server.dump()).tasks.find((t) => t.id === 'importanttask01').priority).toBe(3)

    // The app updates to version 2: the migration adds priority, with 0 everywhere
    const newApp = await oldApp.reopen()
    expect((await newApp.tasks.find('importanttask01'))._raw.priority).toBe(0)

    // The next sync tells the server which columns were added, and gets the records where the
    // server has something other than the default (Backend.md, pull 6)
    await newApp.sync()
    expect(newApp.pulls[0].migration).toEqual({
      from: 1,
      tables: [],
      columns: [{ table: 'tasks', columns: ['priority'] }],
    })
    const pulled = newApp.pulls[0].result.changes.tasks
    expect(pulled.updated.map((t) => t.id)).toEqual(['importanttask01'])

    const state = await expectConverged(server, [newApp])
    expect(state.tasks.find((t) => t.id === 'importanttask01')).toMatchObject({
      name: 'Important (edited on v1)',
      priority: 3,
    })
  })

  // Apps that turned migration syncs on after they shipped: the device logged in on schema version
  // 1 with an app that didn't pass migrationsEnabledAtVersion, and the backend only learned about
  // migration syncs in the release that brought version 2
  describe('when migration syncs were turned on after the app shipped', () => {
    const priorities = [
      { id: 'importanttask01', name: 'Important', priority: 3 },
      { id: 'regulartask0001', name: 'Regular', priority: 0 },
    ]

    async function loggedInOnVersion1() {
      await server.write('tasks', { upsert: priorities })
      const oldApp = makeClient(server, adapterKind, { schema: schemaV1 })
      await oldApp.sync({ migrationsEnabledAtVersion: undefined })
      expect(oldApp.pulls[0].migration).toBe(null)
      return oldApp
    }

    let warn
    beforeEach(() => {
      warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
    })
    afterEach(() => warn.mockRestore())

    it('migrates from the version the device logged in on, even if migrationsEnabledAtVersion is later', async () => {
      const oldApp = await loggedInOnVersion1()
      // The library notes the schema version of the first sync, migration syncs or not
      expect(
        await oldApp.database.adapter.getLocal('__watermelon_last_pulled_schema_version'),
      ).toBe('1')

      const newApp = await oldApp.reopen()
      await newApp.sync({ migrationsEnabledAtVersion: 2 })
      expect(newApp.pulls[0].migration).toEqual({
        from: 1,
        tables: [],
        columns: [{ table: 'tasks', columns: ['priority'] }],
      })
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('fallback initial schema version'),
      )

      const state = await expectConverged(server, [newApp])
      expect(state.tasks.find((t) => t.id === 'importanttask01').priority).toBe(3)
      expect(
        await newApp.database.adapter.getLocal('__watermelon_last_pulled_schema_version'),
      ).toBe('2')
    })

    // A device that logged in before the library noted the schema version (WatermelonDB < 0.17, or
    // that value lost) has only migrationsEnabledAtVersion to go by
    async function withoutNotedVersion() {
      const oldApp = await loggedInOnVersion1()
      await oldApp.database.adapter.removeLocal('__watermelon_last_pulled_schema_version')
      return oldApp.reopen()
    }

    it('falls back to migrationsEnabledAtVersion when the device has no noted version', async () => {
      const newApp = await withoutNotedVersion()
      await newApp.sync({ migrationsEnabledAtVersion: 1 })
      expect(newApp.pulls[0].migration).toEqual({
        from: 1,
        tables: [],
        columns: [{ table: 'tasks', columns: ['priority'] }],
      })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('fallback initial schema version'))

      const state = await expectConverged(server, [newApp])
      expect(state.tasks.find((t) => t.id === 'importanttask01').priority).toBe(3)
    })

    it("can't pull a column added before migrationsEnabledAtVersion when the device has no noted version", async () => {
      // Documented limitation (Sync / Frontend, Migration Syncs, 4): migrationsEnabledAtVersion 2
      // says the device already has every column of version 2, so priority isn't asked for
      const newApp = await withoutNotedVersion()
      await newApp.sync({ migrationsEnabledAtVersion: 2 })
      expect(newApp.pulls[0].migration).toBe(null)

      expect((await newApp.tasks.find('importanttask01')).priority).toBe(0)
      expect((await server.dump()).tasks.find((t) => t.id === 'importanttask01').priority).toBe(3)
    })
  })
})
