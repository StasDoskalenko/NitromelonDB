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
//
// On Hermes, each phase also records JS heap size (end and peak) and GC count/time. The gcCount/gcMs
// totals cover the whole run, including the untimed local edits before the push.

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
  // null when the JS engine isn't Hermes (no HermesInternal.getInstrumentedStats)
  memory: SyncMemory | null
}

export type PhaseMemory = {
  // JS heap size (bytes the Hermes GC has reserved) at the end of the phase, and the highest value
  // seen while it ran (sampled after every synchronize() chunk). Hermes reserves the heap in 4 MB
  // segments, so this moves in 4 MB steps.
  heapEndBytes: number
  heapPeakBytes: number
  // Bytes actually allocated in the JS heap -- byte-accurate, unlike heap size
  allocatedEndBytes: number
  allocatedPeakBytes: number
  gcCount: number
  gcMs: number
}

export type SyncMemory = {
  heapStartBytes: number
  heapPeakBytes: number
  allocatedStartBytes: number
  allocatedPeakBytes: number
  gcCount: number
  gcMs: number
  initialPull: PhaseMemory
  updatePull: PhaseMemory
  fetchAll: PhaseMemory
  push: PhaseMemory
}

type HermesStats = { heapSize: number; allocated: number; numGCs: number; gcTimeMs: number }

// Hermes-only, no native module needed. Field names from Hermes' getInstrumentedStats().
// js_gcTime is in seconds.
function readHermesStats(): HermesStats | null {
  const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } })
    .HermesInternal
  const stats = hermes?.getInstrumentedStats?.()
  if (!stats || typeof stats.js_heapSize !== 'number') {
    return null
  }
  return {
    heapSize: stats.js_heapSize,
    allocated: stats.js_allocatedBytes ?? 0,
    numGCs: stats.js_numGCs ?? 0,
    gcTimeMs: (stats.js_gcTime ?? 0) * 1000,
  }
}

class MemoryTracker {
  _start: HermesStats | null = readHermesStats()
  _phaseStart: HermesStats | null = this._start
  _phasePeak = this._start?.heapSize ?? 0
  _phaseAllocatedPeak = this._start?.allocated ?? 0
  _overallPeak = this._phasePeak
  _overallAllocatedPeak = this._phaseAllocatedPeak

  sample(): void {
    const stats = readHermesStats()
    if (stats) {
      this._phasePeak = Math.max(this._phasePeak, stats.heapSize)
      this._overallPeak = Math.max(this._overallPeak, stats.heapSize)
      this._phaseAllocatedPeak = Math.max(this._phaseAllocatedPeak, stats.allocated)
      this._overallAllocatedPeak = Math.max(this._overallAllocatedPeak, stats.allocated)
    }
  }

  endPhase(): PhaseMemory | null {
    this.sample()
    const end = readHermesStats()
    const start = this._phaseStart
    if (!end || !start) {
      return null
    }
    const phase = {
      heapEndBytes: end.heapSize,
      heapPeakBytes: this._phasePeak,
      allocatedEndBytes: end.allocated,
      allocatedPeakBytes: this._phaseAllocatedPeak,
      gcCount: end.numGCs - start.numGCs,
      gcMs: end.gcTimeMs - start.gcTimeMs,
    }
    this._phaseStart = end
    this._phasePeak = end.heapSize
    this._phaseAllocatedPeak = end.allocated
    return phase
  }

  summary(phases: Record<'initialPull' | 'updatePull' | 'fetchAll' | 'push', PhaseMemory | null>): SyncMemory | null {
    const end = readHermesStats()
    const { initialPull, updatePull, fetchAll, push } = phases
    if (!this._start || !end || !initialPull || !updatePull || !fetchAll || !push) {
      return null
    }
    return {
      heapStartBytes: this._start.heapSize,
      heapPeakBytes: this._overallPeak,
      allocatedStartBytes: this._start.allocated,
      allocatedPeakBytes: this._overallAllocatedPeak,
      gcCount: end.numGCs - this._start.numGCs,
      gcMs: end.gcTimeMs - this._start.gcTimeMs,
      initialPull,
      updatePull,
      fetchAll,
      push,
    }
  }
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
  memory: MemoryTracker,
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
    memory.sample()
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

  const memory = new MemoryTracker()

  const initialPullMs = await pullInChunks(database, synchronize, options, 0, memory)
  const initialPullMemory = memory.endPhase()

  database = await openDatabase()
  const updatePullMs = await pullInChunks(database, synchronize, options, 1, memory)
  const updatePullMemory = memory.endPhase()

  database = await openDatabase()
  const fetchStarted = now()
  const all = await (database.get(SYNC_TABLE) as SyncCollection).query().fetch()
  const fetchAllMs = now() - fetchStarted
  const fetchAllMemory = memory.endPhase()

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
  memory.endPhase() // local edits aren't part of any timed phase
  const pushStarted = now()
  await synchronize({
    database: database as never,
    pullChanges: async () => ({ changes: {}, timestamp: 9_000_000_000 }),
    pushChanges: async () => {},
  })
  const pushMs = now() - pushStarted
  const pushMemory = memory.endPhase()

  return {
    ...options,
    initialPullMs,
    updatePullMs,
    fetchAllMs,
    pushMs,
    totalMs: initialPullMs + updatePullMs + fetchAllMs + pushMs,
    memory: memory.summary({
      initialPull: initialPullMemory,
      updatePull: updatePullMemory,
      fetchAll: fetchAllMemory,
      push: pushMemory,
    }),
  }
}
