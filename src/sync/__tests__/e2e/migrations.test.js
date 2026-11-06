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
})
