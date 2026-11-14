import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { nextTimestamp, type Db } from './db.ts'
import type { ServerSchema } from './schema.ts'
import { parsePullParams, pull, push, SyncError, type RawRecord } from './sync.ts'

export type AppOptions = {
  // Extra endpoints for end-to-end tests. Never enable this in production: they read and change
  // every record without any checks.
  testHooks?: boolean
  // See PullOptions in sync.ts. Defaults to true.
  sendCreatedAsUpdated?: boolean
  // Lets a web app on this origin call the server from the browser ("*" for any). Without it,
  // browsers block requests from other origins; native apps don't need it.
  corsOrigin?: string | null
}

// HTTP layer only: the sync logic is in sync.ts.
//
//   GET  /sync/pull?last_pulled_at=&schema_version=&migration=  ->  { changes, timestamp }
//   POST /sync/push   { changes, lastPulledAt }                 ->  { ok: true }
//
// A real app would also authenticate the user here and scope every query to what they may access.
export function createApp(db: Db, schema: ServerSchema, options: AppOptions = {}): Hono {
  const app = new Hono()
  const sendCreatedAsUpdated = options.sendCreatedAsUpdated ?? true

  if (options.corsOrigin) {
    app.use('*', cors({ origin: options.corsOrigin }))
  }

  app.get('/health', (c) => c.json({ ok: true, sendCreatedAsUpdated }))

  app.get('/sync/pull', (c) => {
    const params = parsePullParams({
      last_pulled_at: c.req.query('last_pulled_at'),
      schema_version: c.req.query('schema_version'),
      migration: c.req.query('migration'),
    })
    return c.json(pull(db, schema, params, { sendCreatedAsUpdated }))
  })

  app.post('/sync/push', async (c) => {
    const body = await c.req.json().catch(() => {
      throw new SyncError(400, 'Body must be JSON')
    })
    const { changes, lastPulledAt } = (body ?? {}) as { changes?: unknown; lastPulledAt?: unknown }
    push(db, schema, { changes, lastPulledAt })
    return c.json({ ok: true })
  })

  if (options.testHooks) {
    addTestHooks(app, db, schema)
  }

  app.onError((error, c) => {
    if (error instanceof SyncError) {
      return c.json({ error: error.message, conflicts: error.conflicts }, error.status)
    }
    console.error(error)
    return c.json({ error: 'Internal server error' }, 500)
  })

  return app
}

function addTestHooks(app: Hono, db: Db, schema: ServerSchema): void {
  // Every row, including tombstones and the change-tracking columns
  app.get('/__test/dump', (c) => {
    const dump: Record<string, unknown[]> = {}
    for (const table of schema.tables) {
      dump[table.name] = db.prepare(`select * from "${table.name}" order by "id"`).all()
    }
    return c.json(dump)
  })

  // Empties every table, as if the server had just been set up
  app.post('/__test/reset', (c) => {
    db.transaction(() => {
      for (const table of schema.tables) {
        db.prepare(`delete from "${table.name}"`).run()
      }
      db.prepare('update sync_clock set value = ? where id = 1').run(Date.now())
    })()
    return c.json({ ok: true })
  })

  // A change made on the server itself, not through sync (an admin panel, another service, a
  // cron job...). It goes through the same change tracking, so clients pick it up on their next
  // pull, and a client pushing a stale version of these records gets a conflict.
  app.post('/__test/write', async (c) => {
    const {
      table: tableName,
      upsert = [],
      delete: deleteIds = [],
    } = (await c.req.json()) as {
      table: string
      upsert?: RawRecord[]
      delete?: string[]
    }
    if (!schema.tables.some((table) => table.name === tableName)) {
      throw new SyncError(400, `Unknown table: ${tableName}`)
    }
    db.transaction(() => {
      // Pushing with lastPulledAt = the latest timestamp can't conflict, which is what a write by the
      // server itself should do: it always wins
      const lastPulledAt = nextTimestamp(db)
      push(db, schema, {
        lastPulledAt,
        changes: { [tableName]: { created: [], updated: upsert, deleted: deleteIds } },
      })
    })()
    return c.json({ ok: true })
  })
}
