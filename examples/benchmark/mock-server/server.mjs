#!/usr/bin/env node
// Mock sync server for the Realistic sync card. Serves a deterministic changelog as real HTTP
// responses, so the app pays for fetch + JSON.parse like a production app does.
//
//   node mock-server/server.mjs            # port 8787, or PORT=…
//   adb reverse tcp:8787 tcp:8787          # Android emulator/device; iOS simulator needs nothing
//
// GET /pull?page=N&pulls=P&seed=S -> { changes, timestamp: N + 1, done, records }
//
// Every response lists every table (the "full schema" shape from discussion #109: tables with no
// changes are still present, with empty arrays). The changelog for a (pulls, seed) pair:
//   - first 10 pulls: initial data, ~300 records each spread over a few tables
//   - then mostly tiny pulls: ~35% empty, the rest 1-4 tables with 1-30 records each, mixing
//     created / updated / deleted
//   - every 25th pull: one big table dump of 500 records
// Tune with the query parameters; the app passes them through from the card.

import http from 'node:http'
import { tableShapes } from './shape.mjs'

const PORT = Number(process.env.PORT ?? 8787)
const TABLES = tableShapes()

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeRow(table, index, revision) {
  const row = { id: `${table.name}-${index}` }
  table.columns.forEach((column, c) => {
    if (column.name === 'parent_id') {
      row.parent_id = `p-${index % 97}`
    } else if (column.type === 'number') {
      row[column.name] = (index * 31 + revision * 7 + c) % 100000
    } else if (column.type === 'boolean') {
      row[column.name] = (index + revision + c) % 2 === 0
    } else {
      // mostly short strings, some longer text
      row[column.name] =
        c % 5 === 1
          ? `Text for ${table.name} #${index}, revision ${revision}. `.repeat(2)
          : `${column.name}-${index}-${revision}`
    }
  })
  return row
}

function emptyChanges() {
  return Object.fromEntries(TABLES.map((t) => [t.name, { created: [], updated: [], deleted: [] }]))
}

// Returns the JSON body of every page, generated once per (pulls, seed)
const cache = new Map()
function changelog(pulls, seed) {
  const key = `${pulls}:${seed}`
  if (cache.has(key)) {
    return cache.get(key)
  }
  const random = mulberry32(seed)
  const pick = (n) => Math.floor(random() * n)
  const live = TABLES.map(() => []) // live record indexes per table
  const next = TABLES.map(() => 0)
  const pages = []

  // Updates and deletes only touch records that existed before this page (`settled`), and each
  // record at most once per page -- a real server never lists one id as both created and
  // updated/deleted in the same response.
  const addChanges = (changes, t, count, revision, touched) => {
    const table = TABLES[t]
    const set = changes[table.name]
    const settled = live[t].filter((index) => !touched.has(`${t}:${index}`))
    for (let i = 0; i < count; i += 1) {
      const roll = random()
      if (settled.length && roll < 0.35) {
        const [index] = settled.splice(pick(settled.length), 1)
        touched.add(`${t}:${index}`)
        set.updated.push(makeRow(table, index, revision))
      } else if (settled.length > 5 && roll < 0.4) {
        const [index] = settled.splice(pick(settled.length), 1)
        touched.add(`${t}:${index}`)
        live[t].splice(live[t].indexOf(index), 1)
        set.deleted.push(`${table.name}-${index}`)
      } else {
        const index = next[t]
        next[t] += 1
        live[t].push(index)
        touched.add(`${t}:${index}`)
        set.created.push(makeRow(table, index, revision))
      }
    }
  }

  for (let page = 0; page < pulls; page += 1) {
    const changes = emptyChanges()
    const revision = page + 1
    const touched = new Set()
    if (page < 10) {
      for (let k = 0; k < 5; k += 1) {
        addChanges(changes, pick(TABLES.length), 60, revision, touched)
      }
    } else if (page % 25 === 24) {
      const t = pick(TABLES.length)
      const set = changes[TABLES[t].name]
      for (let i = 0; i < 500; i += 1) {
        const index = next[t]
        next[t] += 1
        live[t].push(index)
        set.created.push(makeRow(TABLES[t], index, revision))
      }
    } else if (random() >= 0.35) {
      const tables = 1 + pick(4)
      for (let k = 0; k < tables; k += 1) {
        addChanges(changes, pick(TABLES.length), 1 + pick(30), revision, touched)
      }
    }
    const records = Object.values(changes).reduce(
      (sum, set) => sum + set.created.length + set.updated.length + set.deleted.length,
      0,
    )
    pages.push(JSON.stringify({ changes, timestamp: page + 1, done: page === pulls - 1, records }))
  }
  cache.set(key, pages)
  return pages
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`)
  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('ok')
    return
  }
  if (url.pathname !== '/pull') {
    response.writeHead(404)
    response.end()
    return
  }
  const pulls = Math.max(1, Number(url.searchParams.get('pulls') ?? 300))
  const seed = Number(url.searchParams.get('seed') ?? 1)
  const page = Number(url.searchParams.get('page') ?? 0)
  const pages = changelog(pulls, seed)
  if (!(page >= 0 && page < pages.length)) {
    response.writeHead(400)
    response.end(`page must be 0..${pages.length - 1}`)
    return
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(pages[page])
})

server.listen(PORT, () => {
  console.log(`mock sync server on http://localhost:${PORT} (${TABLES.length} tables)`)
})
