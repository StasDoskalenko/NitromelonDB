import { serve } from '@hono/node-server'

import { createApp } from './app.ts'
import { openDatabase } from './db.ts'
import { schemas } from './schema.ts'

// Configuration through environment variables:
//   PORT                    default 3000 (0 picks a free port)
//   HOST                    default 127.0.0.1 (use 0.0.0.0 to reach it from a phone on your network)
//   DATABASE                SQLite file, default sync.db (":memory:" for a throwaway database)
//   SYNC_SERVER_SCHEMA      which tables to sync: "default" (src/schema.ts, used by the library's
//                           tests) or "notes-app" (the example NotesApp)
//   SYNC_SERVER_SEND_CREATED  "1" splits pulled records into `created` and `updated` instead of
//                           sending everything as `updated` (see README.md before using it)
//   SYNC_SERVER_CORS_ORIGIN lets a web app on this origin call the server ("*" for any origin)
//   SYNC_SERVER_TEST_HOOKS  "1" enables the /__test endpoints used by the end-to-end tests
const port = Number(process.env.PORT ?? 3000)
const hostname = process.env.HOST ?? '127.0.0.1'
const schemaName = process.env.SYNC_SERVER_SCHEMA ?? 'default'
const schema = schemas[schemaName]
if (!schema) {
  throw new Error(
    `Unknown SYNC_SERVER_SCHEMA "${schemaName}". Use one of: ${Object.keys(schemas).join(', ')}`,
  )
}
const db = openDatabase(process.env.DATABASE ?? 'sync.db', schema)
const app = createApp(db, schema, {
  testHooks: process.env.SYNC_SERVER_TEST_HOOKS === '1',
  sendCreatedAsUpdated: process.env.SYNC_SERVER_SEND_CREATED !== '1',
  corsOrigin: process.env.SYNC_SERVER_CORS_ORIGIN || null,
})

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  // The end-to-end tests wait for this line to learn the port
  console.log(`sync server listening on http://${hostname}:${info.port}`)
})

const shutdown = (): void => {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
