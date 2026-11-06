// End-to-end sync tests: real NitromelonDB databases syncing over HTTP with the reference server in
// examples/sync-server. Run with `yarn test:sync-e2e` (after `yarn --cwd examples/sync-server install`).
// Not part of `yarn test`, because they need the server's dependencies.
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import readline from 'readline'

import Database from '../../../Database'
import Model from '../../../Model'
import SQLiteAdapter from '../../../adapters/sqlite'
import LokiJSAdapter from '../../../adapters/lokijs'
import { appSchema, tableSchema } from '../../../Schema'
import { schemaMigrations, addColumns } from '../../../Schema/migrations'
import { field, text, relation, children } from '../../../decorators'
import { synchronize, hasUnsyncedChanges } from '../../index'

const serverDir = path.resolve(__dirname, '../../../../examples/sync-server')

// MARK: - App schema (the server's copy is in examples/sync-server/src/schema.ts)

export const TABLES = ['projects', 'tasks', 'comments']

const projectsTable = tableSchema({
  name: 'projects',
  columns: [
    { name: 'name', type: 'string' },
    { name: 'is_favorite', type: 'boolean' },
  ],
})
const commentsTable = tableSchema({
  name: 'comments',
  columns: [
    { name: 'task_id', type: 'string', isIndexed: true },
    { name: 'body', type: 'string' },
    { name: 'created_at', type: 'number' },
  ],
})
const taskColumnsV1 = [
  { name: 'project_id', type: 'string', isIndexed: true },
  { name: 'name', type: 'string' },
  { name: 'description', type: 'string', isOptional: true },
  { name: 'position', type: 'number' },
  { name: 'is_completed', type: 'boolean' },
]

// Version 1 doesn't have tasks.priority yet; version 2 adds it in a migration
export const schemaV1 = appSchema({
  version: 1,
  tables: [projectsTable, tableSchema({ name: 'tasks', columns: taskColumnsV1 }), commentsTable],
})
export const schemaV2 = appSchema({
  version: 2,
  tables: [
    projectsTable,
    tableSchema({
      name: 'tasks',
      columns: [...taskColumnsV1, { name: 'priority', type: 'number' }],
    }),
    commentsTable,
  ],
})
const migrationsV2 = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [addColumns({ table: 'tasks', columns: [{ name: 'priority', type: 'number' }] })],
    },
  ],
})

class Project extends Model {
  static table = 'projects'

  static associations = { tasks: { type: 'has_many', foreignKey: 'project_id' } }

  @text('name') name

  @field('is_favorite') isFavorite

  @children('tasks') tasks
}

class Task extends Model {
  static table = 'tasks'

  static associations = {
    projects: { type: 'belongs_to', key: 'project_id' },
    comments: { type: 'has_many', foreignKey: 'task_id' },
  }

  @text('name') name

  @field('description') description

  @field('position') position

  @field('is_completed') isCompleted

  @field('priority') priority

  @relation('projects', 'project_id') project

  @children('comments') comments
}

class Comment extends Model {
  static table = 'comments'

  static associations = { tasks: { type: 'belongs_to', key: 'task_id' } }

  @text('body') body

  @field('created_at') createdAt

  @relation('tasks', 'task_id') task
}

const modelClasses = [Project, Task, Comment]

// An adapter only accepts migrations up to its schema version
const migrationsFor = (schema) =>
  schema.version >= 2 ? migrationsV2 : schemaMigrations({ migrations: [] })

// MARK: - Server

export class SyncHttpError extends Error {
  constructor(status, body) {
    super(`Sync request failed with ${status}: ${body.error || JSON.stringify(body)}`)
    this.status = status
    this.body = body
  }
}

// Starts the reference server on a free port with an in-memory database. By default the server sends
// every pulled record as `updated` (and clients pass sendCreatedAsUpdated); `sendCreated: true`
// splits them into `created` and `updated` instead.
export async function startServer({ sendCreated = false } = {}) {
  if (!fs.existsSync(path.join(serverDir, 'node_modules', 'hono'))) {
    throw new Error(
      'The sync server dependencies are not installed. Run: yarn --cwd examples/sync-server install',
    )
  }

  const child = spawn(process.execPath, ['src/main.ts'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: '0',
      DATABASE: ':memory:',
      SYNC_SERVER_TEST_HOOKS: '1',
      SYNC_SERVER_SEND_CREATED: sendCreated ? '1' : '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stderr = []
  child.stderr.on('data', (chunk) => stderr.push(chunk.toString()))

  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Sync server didn't start:\n${stderr.join('')}`)),
      15000,
    )
    child.on('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Sync server exited with ${code}:\n${stderr.join('')}`))
    })
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      const match = line.match(/listening on (http:\/\/\S+)/)
      if (match) {
        clearTimeout(timeout)
        resolve(match[1])
      }
    })
  })

  const request = async (method, route, body) => {
    const response = await fetch(`${url}${route}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = await response.json()
    if (!response.ok) {
      throw new SyncHttpError(response.status, json)
    }
    return json
  }

  return {
    url,
    sendCreatedAsUpdated: !sendCreated,
    request,
    reset: () => request('POST', '/__test/reset', {}),
    // A change made on the server itself (admin panel, another service...), not through sync
    write: (table, { upsert, delete: deleteIds }) =>
      request('POST', '/__test/write', { table, upsert, delete: deleteIds }),
    dump: () => request('GET', '/__test/dump'),
    stop: () =>
      new Promise((resolve) => {
        child.removeAllListeners('exit')
        child.on('exit', resolve)
        child.kill('SIGTERM')
      }),
  }
}

// Starts a server for the current test file (or describe block), and empties it before each test.
// Returns an object that becomes the server once it's started, so tests can use it directly. Each
// file gets its own temporary directory for SQLite files, deleted at the end: Jest runs several files
// in one process, so file names can't be reused between files.
export function setUpServer(options) {
  const server = {}
  let tmpDir = null
  beforeAll(async () => {
    fs.mkdirSync('.tmp', { recursive: true })
    tmpDir = fs.mkdtempSync(path.join('.tmp', 'sync-e2e-'))
    Object.assign(server, await startServer(options), { tmpDir })
  })
  afterAll(async () => {
    if (server.stop) {
      await server.stop()
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
  beforeEach(() => server.reset())
  return server
}

// MARK: - Clients

export const ADAPTERS = ['sqlite', 'loki']

let clientCounter = 0

// A device running the app: a real Database, synced with the server over HTTP
export function makeClient(server, adapterKind, { schema = schemaV2 } = {}) {
  clientCounter += 1
  const name = path.join(server.tmpDir || '.tmp', `client-${clientCounter}.db`)
  const adapter =
    adapterKind === 'sqlite'
      ? new SQLiteAdapter({ schema, migrations: migrationsFor(schema), dbName: name })
      : new LokiJSAdapter({
          schema,
          migrations: migrationsFor(schema),
          dbName: name,
          useWebWorker: false,
          useIncrementalIndexedDB: false,
        })
  const database = new Database({ adapter, schema, modelClasses })
  return new Client(server, database, adapterKind, name)
}

export class Client {
  constructor(server, database, adapterKind, dbName) {
    this.server = server
    this.database = database
    this.adapterKind = adapterKind
    this.dbName = dbName
    this.projects = database.get('projects')
    this.tasks = database.get('tasks')
    this.comments = database.get('comments')
    // Set to true to make every request fail, like a device without network
    this.offline = false
    this.pulls = []
    this.pushes = []
    // Hooks to run code at a precise point of a sync: afterPull runs between pulling and pushing
    // (to let another device sneak in a change), afterPush after a push succeeded on the server
    // (throw from it to lose the response, as if the app crashed)
    this.afterPull = null
    this.afterPush = null
  }

  async pullChanges({ lastPulledAt, schemaVersion, migration }) {
    if (this.offline) {
      throw new TypeError('Network request failed')
    }
    const query = new URLSearchParams({
      last_pulled_at: lastPulledAt ? String(lastPulledAt) : '',
      schema_version: String(schemaVersion),
      migration: JSON.stringify(migration),
    })
    const result = await this.server.request('GET', `/sync/pull?${query}`)
    this.pulls.push({ lastPulledAt, schemaVersion, migration, result })
    if (this.afterPull) {
      const hook = this.afterPull
      this.afterPull = null
      await hook()
    }
    return result
  }

  async pushChanges({ changes, lastPulledAt }) {
    if (this.offline) {
      throw new TypeError('Network request failed')
    }
    this.pushes.push({ changes, lastPulledAt })
    await this.server.request('POST', '/sync/push', { changes, lastPulledAt })
    if (this.afterPush) {
      const hook = this.afterPush
      this.afterPush = null
      await hook()
    }
  }

  sync(extraArgs = {}) {
    return synchronize({
      database: this.database,
      pullChanges: (args) => this.pullChanges(args),
      pushChanges: (args) => this.pushChanges(args),
      migrationsEnabledAtVersion: 1,
      sendCreatedAsUpdated: this.server.sendCreatedAsUpdated,
      ...extraArgs,
    })
  }

  // Syncs until it succeeds: a push rejected with 409 (someone else changed the same records)
  // means pull again and retry, which is what an app should do
  async syncUntilDone({ maxAttempts = 5, ...extraArgs } = {}) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.sync(extraArgs)
        return attempt
      } catch (error) {
        if (!(error instanceof SyncHttpError && error.status === 409) || attempt >= maxAttempts) {
          throw error
        }
      }
    }
  }

  hasUnsyncedChanges() {
    return hasUnsyncedChanges({ database: this.database })
  }

  write(fn) {
    return this.database.write(fn)
  }

  // What this device has, in the same format as serverSnapshot()
  async snapshot() {
    const result = {}
    for (const table of TABLES) {
      const records = await this.database.get(table).query().fetch()
      result[table] = records
        .map((record) => {
          const raw = { ...record._raw }
          delete raw._status
          delete raw._changed
          return raw
        })
        .sort(byId)
    }
    return result
  }

  // Simulates an app restart: a new Database on the same data, possibly with a newer schema
  async reopen(schema = schemaV2) {
    const adapter =
      this.adapterKind === 'sqlite'
        ? new SQLiteAdapter({ schema, migrations: migrationsFor(schema), dbName: this.dbName })
        : await this.database.adapter.underlyingAdapter.testClone({
            schema,
            migrations: migrationsFor(schema),
          })
    const database = new Database({ adapter, schema, modelClasses })
    const client = new Client(this.server, database, this.adapterKind, this.dbName)
    return client
  }
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// What the server has (not counting deleted records), in the format of Client#snapshot()
export async function serverSnapshot(server, schema = schemaV2) {
  const dump = await server.dump()
  const result = {}
  for (const table of TABLES) {
    const columns = schema.tables[table].columnArray
    result[table] = dump[table]
      .filter((row) => !row.deleted)
      .map((row) => {
        const raw = { id: row.id }
        columns.forEach(({ name, type }) => {
          const value = row[name]
          raw[name] = type === 'boolean' && value !== null ? value === 1 : value
        })
        return raw
      })
      .sort(byId)
  }
  return result
}

// Every client has exactly what the server has, and nothing left to push
export async function expectConverged(server, clients) {
  const expected = await serverSnapshot(server)
  for (const client of clients) {
    expect(await client.hasUnsyncedChanges()).toBe(false)
    expect(await client.snapshot()).toEqual(expected)
  }
  return expected
}
