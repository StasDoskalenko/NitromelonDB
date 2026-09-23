// Sync workload shared by both benchmark apps, so NitromelonDB and upstream WatermelonDB run the
// exact same synchronize() calls against the same data shape. Each app passes in its own
// `synchronize`, a fresh Database, and the table name. See SyncBenchmarkCard.tsx for the UI.
//
// Phases, timed separately:
//   1. initialPull -- N records arrive as `created`, split into chunks, one synchronize() per chunk
//      (the "initial sync of data, split to chunks" shape reported in discussion #109)
//   2. updatePull  -- the same N records arrive again as `updated`. Sync first reads every
//      existing row back from SQLite, so this is the phase most sensitive to native -> JS row
//      conversion cost
//   3. fetchAll    -- query().fetch() of all N records with a cold JS cache
//   4. push        -- M records changed locally, then synchronize() pushes and marks them synced

export const SYNC_TABLE = 'sync_items'

export const SYNC_COLUMNS = [
  { name: 'title', type: 'string' },
  { name: 'body', type: 'string' },
  { name: 'status', type: 'string' },
  { name: 'owner_id', type: 'string', isIndexed: true },
  { name: 'image_id', type: 'string' },
  { name: 'position', type: 'number' },
  { name: 'score', type: 'number' },
  { name: 'priority', type: 'number' },
  { name: 'is_pinned', type: 'boolean' },
  { name: 'is_archived', type: 'boolean' },
  { name: 'created_at', type: 'number' },
  { name: 'updated_at', type: 'number' },
] as const

type RawRow = Record<string, string | number | boolean | null>

type SyncRecord = {
  prepareUpdate(recordUpdater: (record: SyncRecord) => void): unknown
  _setRaw(column: string, value: string | number | boolean | null): void
}

type SyncCollection = {
  query(): { fetch(): Promise<SyncRecord[]> }
}

export type SyncDatabase = {
  get(table: string): unknown
  write<T>(action: () => Promise<T>): Promise<T>
  batch(records: unknown[]): Promise<void>
  unsafeResetDatabase(): Promise<void>
}

// Returns a new Database instance on the same SQLite file. Every phase starts from a fresh
// instance, so neither the JS record cache nor the adapter's "already sent to JS" set carries
// over -- the same as a sync that runs after an app restart. The app may close the previous
// instance here.
export type OpenSyncDatabase = () => Promise<SyncDatabase>

type TableChanges = { created: RawRow[]; updated: RawRow[]; deleted: string[] }

export type SynchronizeFn = (args: {
  database: never
  pullChanges: (args: { lastPulledAt?: number | null }) => Promise<{
    changes: Record<string, TableChanges>
    timestamp: number
  }>
  pushChanges?: (args: { changes: unknown; lastPulledAt: number }) => Promise<void>
  sendCreatedAsUpdated?: boolean
}) => Promise<void>

export type SyncBenchmarkOptions = {
  records: number
  chunkSize: number
  pushCount: number
}

export type SyncBenchmarkResult = SyncBenchmarkOptions & {
  initialPullMs: number
  updatePullMs: number
  fetchAllMs: number
  pushMs: number
  totalMs: number
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function makeRow(index: number, revision: number): RawRow {
  return {
    id: `sync-${index}`,
    title: `Item ${index} r${revision}`,
    body: `Body for item ${index}, revision ${revision}. `.repeat(3),
    status: index % 3 === 0 ? 'open' : 'closed',
    owner_id: `owner-${index % 50}`,
    image_id: String(index % 997),
    position: index,
    score: (index * 7 + revision) % 1000,
    priority: index % 5,
    is_pinned: index % 11 === 0,
    is_archived: false,
    created_at: 1_700_000_000_000 + index,
    updated_at: 1_700_000_000_000 + index + revision,
  }
}

async function pullInChunks(
  database: SyncDatabase,
  synchronize: SynchronizeFn,
  { records, chunkSize }: SyncBenchmarkOptions,
  revision: number,
): Promise<number> {
  const started = now()
  let timestamp = revision * 1_000_000
  for (let start = 0; start < records; start += chunkSize) {
    const end = Math.min(start + chunkSize, records)
    const rows: RawRow[] = []
    for (let index = start; index < end; index += 1) {
      rows.push(makeRow(index, revision))
    }
    timestamp += 1
    const pulledAt = timestamp
    // eslint-disable-next-line no-await-in-loop
    await synchronize({
      database: database as never,
      sendCreatedAsUpdated: revision > 0,
      pullChanges: async () => ({
        changes: {
          [SYNC_TABLE]:
            revision === 0
              ? { created: rows, updated: [], deleted: [] }
              : { created: [], updated: rows, deleted: [] },
        },
        timestamp: pulledAt,
      }),
      pushChanges: async () => {},
    })
  }
  return now() - started
}

export async function runSyncBenchmark(
  openDatabase: OpenSyncDatabase,
  synchronize: SynchronizeFn,
  options: SyncBenchmarkOptions,
): Promise<SyncBenchmarkResult> {
  let database = await openDatabase()
  await database.write(() => database.unsafeResetDatabase())

  const initialPullMs = await pullInChunks(database, synchronize, options, 0)

  database = await openDatabase()
  const updatePullMs = await pullInChunks(database, synchronize, options, 1)

  database = await openDatabase()
  const fetchStarted = now()
  const all = await (database.get(SYNC_TABLE) as SyncCollection).query().fetch()
  const fetchAllMs = now() - fetchStarted

  const toChange = all.slice(0, options.pushCount)
  await database.write(() =>
    database.batch(
      toChange.map((record) =>
        record.prepareUpdate((r) => {
          r._setRaw('title', 'changed locally')
        }),
      ),
    ),
  )
  const pushStarted = now()
  await synchronize({
    database: database as never,
    pullChanges: async () => ({ changes: {}, timestamp: 9_000_000_000 }),
    pushChanges: async () => {},
  })
  const pushMs = now() - pushStarted

  return {
    ...options,
    initialPullMs,
    updatePullMs,
    fetchAllMs,
    pushMs,
    totalMs: initialPullMs + updatePullMs + fetchAllMs + pushMs,
  }
}
