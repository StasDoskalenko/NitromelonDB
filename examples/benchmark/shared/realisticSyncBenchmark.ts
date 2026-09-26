// Realistic sync: an initial sync of a fresh install against the mock server in ../mock-server,
// the way a production app does it -- fetch each page over HTTP, JSON.parse it, synchronize(),
// repeat until the server says it's done. 80 tables, every response lists all of them, and most
// pulls are empty or tiny (discussion #109). See ../mock-server/server.mjs for the changelog.
//
// Reported separately, so a difference can be pinned to the library or not:
//   openMs     -- new Database until the first query answers (creates the schema)
//   networkMs  -- fetch() until the body text arrives
//   parseMs    -- JSON.parse of the body
//   libraryMs  -- time inside synchronize() minus network + parse: everything the library does
//   totalMs    -- wall clock for all of it

import shape from './realisticSyncShape.json'

export type RealisticColumn = {
  name: string
  type: 'string' | 'number' | 'boolean'
  isIndexed?: boolean
}
export const REALISTIC_TABLES: { name: string; columns: RealisticColumn[] }[] = shape.tables as {
  name: string
  columns: RealisticColumn[]
}[]

// Android emulator/device reach the host through `adb reverse tcp:8787 tcp:8787`
export const MOCK_SERVER_URL = 'http://localhost:8787'

type TableChanges = { created: unknown[]; updated: unknown[]; deleted: string[] }
type PullResponse = {
  changes: Record<string, TableChanges>
  timestamp: number
  done: boolean
  records: number
}

export type RealisticDatabase = {
  get(table: string): unknown
}

type CountableCollection = { query(): { fetchCount(): Promise<number> } }

export type RealisticSynchronizeFn = (args: {
  database: never
  pullChanges: (args: { lastPulledAt?: number | null }) => Promise<{
    changes: Record<string, TableChanges>
    timestamp: number
  }>
  pushChanges?: (args: { changes: unknown; lastPulledAt: number }) => Promise<void>
}) => Promise<void>

export type RealisticSyncOptions = { pulls: number; seed?: number }

export type RealisticSyncResult = RealisticSyncOptions & {
  kind: 'realistic'
  tables: number
  calls: number
  records: number
  bytes: number
  openMs: number
  networkMs: number
  parseMs: number
  libraryMs: number
  totalMs: number
  // Median time inside synchronize() minus network + parse, by records in the pull
  libraryEmptyMedianMs: number
  librarySmallMedianMs: number
  gcCount: number | null
  gcMs: number | null
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function median(values: number[]): number {
  if (!values.length) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function hermesGc(): { count: number; ms: number } | null {
  const stats = (
    globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } }
  ).HermesInternal?.getInstrumentedStats?.()
  return stats && typeof stats.js_numGCs === 'number'
    ? { count: stats.js_numGCs, ms: (stats.js_gcTime ?? 0) * 1000 }
    : null
}

// Every run opens a database file that has never existed, like a fresh install -- so openMs
// includes creating the schema. (Files from earlier runs are left behind; the scripted runner
// clears app data between runs.)
export async function runRealisticSyncBenchmark(
  openDatabase: (dbName: string) => Promise<RealisticDatabase>,
  synchronize: RealisticSynchronizeFn,
  { pulls, seed = 1 }: RealisticSyncOptions,
): Promise<RealisticSyncResult> {
  // Fail fast with a useful message if the server isn't reachable
  try {
    await fetch(`${MOCK_SERVER_URL}/health`)
  } catch {
    throw new Error(
      `Mock sync server not reachable at ${MOCK_SERVER_URL}. Run \`node mock-server/server.mjs\` (and \`adb reverse tcp:8787 tcp:8787\` on Android).`,
    )
  }

  const gcStart = hermesGc()
  const started = now()

  const database = await openDatabase(`realistic-${Date.now()}`)
  await (database.get(REALISTIC_TABLES[0]!.name) as CountableCollection).query().fetchCount()
  const openMs = now() - started

  let networkMs = 0
  let parseMs = 0
  let libraryMs = 0
  let records = 0
  let bytes = 0
  let calls = 0
  let done = false
  const libraryEmpty: number[] = []
  const librarySmall: number[] = []

  while (!done) {
    let pullNetwork = 0
    let pullParse = 0
    let pullRecords = 0
    const callStarted = now()
    // eslint-disable-next-line no-await-in-loop
    await synchronize({
      database: database as never,
      pullChanges: async ({ lastPulledAt }) => {
        const page = lastPulledAt ?? 0 // timestamp N + 1 is returned for page N
        const fetchStarted = now()
        const response = await fetch(
          `${MOCK_SERVER_URL}/pull?page=${page}&pulls=${pulls}&seed=${seed}`,
        )
        const text = await response.text()
        const parseStarted = now()
        const body = JSON.parse(text) as PullResponse
        pullParse = now() - parseStarted
        pullNetwork = parseStarted - fetchStarted
        bytes += text.length
        pullRecords = body.records
        done = body.done
        return { changes: body.changes, timestamp: body.timestamp }
      },
      pushChanges: async () => {},
    })
    const library = now() - callStarted - pullNetwork - pullParse
    networkMs += pullNetwork
    parseMs += pullParse
    libraryMs += library
    records += pullRecords
    calls += 1
    if (pullRecords === 0) {
      libraryEmpty.push(library)
    } else if (pullRecords < 100) {
      librarySmall.push(library)
    }
  }

  const totalMs = now() - started
  const gcEnd = hermesGc()
  return {
    kind: 'realistic',
    pulls,
    seed,
    tables: REALISTIC_TABLES.length,
    calls,
    records,
    bytes,
    openMs,
    networkMs,
    parseMs,
    libraryMs,
    totalMs,
    libraryEmptyMedianMs: median(libraryEmpty),
    librarySmallMedianMs: median(librarySmall),
    gcCount: gcStart && gcEnd ? gcEnd.count - gcStart.count : null,
    gcMs: gcStart && gcEnd ? gcEnd.ms - gcStart.ms : null,
  }
}
