// Incremental sync: many small synchronize() calls into a database that already has data, the way
// an app syncs after the first launch. The Sync card (syncBenchmark.ts) only measures large
// chunks into one table; this one measures the fixed cost every synchronize() pays -- reading the
// last-pulled timestamp, looking for local changes in every table, writing the new timestamp --
// which dominates when most pulls are empty or tiny. Shape from discussion #109: 67 pulls, of
// which 35 empty, 21 with 1-99 records, 5 with 100-999 and 6 with 1,000+.
//
// Steps:
//   1. seed      -- TABLE_COUNT tables with `seedPerTable` records each (one synchronize(), untimed
//                   in the per-pull numbers but reported)
//   2. pulls     -- a fresh Database instance, then the PULL_PLAN sequence: every call pulls all
//                   tables (empty changesets included, like a real server response) and has a
//                   pushChanges, so it also looks for local changes
//   3. observed  -- the same sequence again, with three observers per table mounted the way a
//                   screen would: a simple where() (matched in JS), a sorted + limited list
//                   (re-queried on every change), and a count
//
// Every pull is timed until synchronize() resolves plus one macrotask, so re-queries triggered by
// that pull land in its own number instead of the next one's.

import { SYNC_COLUMNS } from './syncBenchmark'

export const TABLE_COUNT = 12
export const INCREMENTAL_TABLES = Array.from({ length: TABLE_COUNT }, (_, index) => `inc_${index}`)
export { SYNC_COLUMNS as INCREMENTAL_COLUMNS }

// Records changed per pull, in call order. Sizes cycle through the tables.
const PULL_PLAN: number[] = [
  0, 12, 7, 0, 350, 0, 40, 0, 1500, 65, 0, 5, 0, 80, 0, 0, 20, 0, 200, 450, 0, 60, 0, 3,
  1200, 0, 0, 30, 0, 0, 90, 0, 1, 0, 600, 0, 15, 0, 0, 45, 0, 2000, 0, 8, 1300, 0, 70, 0,
  25, 0, 150, 0, 0, 1000, 0, 50, 0, 0, 10, 0, 1800, 0, 35, 0, 0, 99, 0, 0,
]

type RawRow = Record<string, string | number | boolean | null>
type TableChanges = { created: RawRow[]; updated: RawRow[]; deleted: string[] }

type Subscription = { unsubscribe(): void }
type Observable = { subscribe(observer: { next(value: unknown): void; error(e: unknown): void }): Subscription }
type ObservableQuery = { observe(): Observable; observeCount(isThrottled?: boolean): Observable }
type IncrementalCollection = { query(...clauses: unknown[]): ObservableQuery }

export type IncrementalDatabase = {
  get(table: string): unknown
  write<T>(action: () => Promise<T>): Promise<T>
  unsafeResetDatabase(): Promise<void>
}

export type IncrementalSynchronizeFn = (args: {
  database: never
  pullChanges: (args: { lastPulledAt?: number | null }) => Promise<{
    changes: Record<string, TableChanges>
    timestamp: number
  }>
  pushChanges?: (args: { changes: unknown; lastPulledAt: number }) => Promise<void>
}) => Promise<void>

// The few Q builders the observers use, passed in so both apps use their own library
export type QueryBuilders = {
  where(column: string, value: unknown): unknown
  sortBy(column: string, order: unknown): unknown
  take(count: number): unknown
  desc: unknown
}

export type IncrementalSyncOptions = { seedPerTable: number }

export type BucketStats = { count: number; medianMs: number; totalMs: number }

export type IncrementalPhaseResult = {
  totalMs: number
  empty: BucketStats
  small: BucketStats // 1-99
  medium: BucketStats // 100-999
  large: BucketStats // 1,000+
  pullsMs: number[]
}

export type IncrementalSyncResult = IncrementalSyncOptions & {
  kind: 'incremental'
  tables: number
  pulls: number
  seedMs: number
  plain: IncrementalPhaseResult
  observed: IncrementalPhaseResult
  observerErrors: number
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

const nextMacrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function makeRow(index: number, revision: number): RawRow {
  return {
    id: `inc-${index}`,
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

function emptyChanges(): Record<string, TableChanges> {
  return Object.fromEntries(
    INCREMENTAL_TABLES.map((table) => [table, { created: [], updated: [], deleted: [] }]),
  )
}

function median(values: number[]): number {
  if (!values.length) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function bucket(plan: number[], times: number[], test: (size: number) => boolean): BucketStats {
  const selected = times.filter((_, index) => test(plan[index]!))
  return {
    count: selected.length,
    medianMs: median(selected),
    totalMs: selected.reduce((sum, value) => sum + value, 0),
  }
}

async function runPulls(
  database: IncrementalDatabase,
  synchronize: IncrementalSynchronizeFn,
  { seedPerTable }: IncrementalSyncOptions,
  revisionBase: number,
): Promise<IncrementalPhaseResult> {
  const times: number[] = []
  let timestamp = revisionBase * 1_000_000
  for (let pull = 0; pull < PULL_PLAN.length; pull += 1) {
    const size = Math.min(PULL_PLAN[pull]!, seedPerTable)
    const table = INCREMENTAL_TABLES[pull % TABLE_COUNT]!
    const changes = emptyChanges()
    const revision = revisionBase + pull + 1
    // Rotate through the table so consecutive pulls don't touch the same rows
    const offset = (pull * 97) % Math.max(1, seedPerTable - size)
    for (let index = offset; index < offset + size; index += 1) {
      changes[table]!.updated.push(makeRow(index, revision))
    }
    timestamp += 1
    const pulledAt = timestamp
    const started = now()
    // eslint-disable-next-line no-await-in-loop
    await synchronize({
      database: database as never,
      pullChanges: async () => ({ changes, timestamp: pulledAt }),
      pushChanges: async () => {},
    })
    // eslint-disable-next-line no-await-in-loop
    await nextMacrotask()
    times.push(now() - started)
  }
  const plan = PULL_PLAN.map((size) => Math.min(size, seedPerTable))
  return {
    totalMs: times.reduce((sum, value) => sum + value, 0),
    empty: bucket(plan, times, (size) => size === 0),
    small: bucket(plan, times, (size) => size > 0 && size < 100),
    medium: bucket(plan, times, (size) => size >= 100 && size < 1000),
    large: bucket(plan, times, (size) => size >= 1000),
    pullsMs: times.map((value) => Math.round(value * 10) / 10),
  }
}

export async function runIncrementalSyncBenchmark(
  openDatabase: () => Promise<IncrementalDatabase>,
  synchronize: IncrementalSynchronizeFn,
  Q: QueryBuilders,
  options: IncrementalSyncOptions,
): Promise<IncrementalSyncResult> {
  let database = await openDatabase()
  await database.write(() => database.unsafeResetDatabase())

  const seed = emptyChanges()
  for (const table of INCREMENTAL_TABLES) {
    for (let index = 0; index < options.seedPerTable; index += 1) {
      seed[table]!.created.push(makeRow(index, 0))
    }
  }
  const seedStarted = now()
  await synchronize({
    database: database as never,
    pullChanges: async () => ({ changes: seed, timestamp: 1 }),
    pushChanges: async () => {},
  })
  const seedMs = now() - seedStarted

  database = await openDatabase()
  const plain = await runPulls(database, synchronize, options, 1_000)

  database = await openDatabase()
  let observerErrors = 0
  const subscriptions: Subscription[] = []
  const observer = { next: () => {}, error: () => (observerErrors += 1) }
  for (const table of INCREMENTAL_TABLES) {
    const collection = database.get(table) as IncrementalCollection
    subscriptions.push(collection.query(Q.where('status', 'open')).observe().subscribe(observer))
    subscriptions.push(
      collection
        .query(Q.where('owner_id', 'owner-1'), Q.sortBy('position', Q.desc), Q.take(20))
        .observe()
        .subscribe(observer),
    )
    subscriptions.push(collection.query().observeCount(false).subscribe(observer))
  }
  // Let every observer finish its initial query before timing starts
  await nextMacrotask()
  await nextMacrotask()
  const observed = await runPulls(database, synchronize, options, 2_000)
  subscriptions.forEach((subscription) => subscription.unsubscribe())

  return {
    kind: 'incremental',
    ...options,
    tables: TABLE_COUNT,
    pulls: PULL_PLAN.length,
    seedMs,
    plain,
    observed,
    observerErrors,
  }
}
