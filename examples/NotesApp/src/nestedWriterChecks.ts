// On-device checks for `experimentalDetectNestedWriters` (issue #154): a nested write()/read()
// without callWriter()/callReader() must throw instead of deadlocking -- even after unrelated
// awaits -- while independent writers keep queueing. The library's Jest suite covers the same
// scenarios on Node; this runs them on the real engine (Hermes) with the app's real Babel output.
// Opened by long-pressing the header title; driven by maestro/nested-writers.yaml.
import { Database } from 'nitromelondb'
import SQLiteAdapter from 'nitromelondb/adapters/sqlite'
import Note from './model/Note'
import { migrations } from './model/migrations'
import { NOTES_TABLE, schema } from './model/schema'

export type CheckStatus = 'pass' | 'fail' | 'skipped'

export type CheckResult = {
  id: string
  label: string
  status: CheckStatus
  detail: string
  // Informational checks don't count towards the summary
  informational?: boolean
}

type Check = {
  id: string
  label: string
  expect: 'deadlock-error' | 'ok'
  informational?: boolean
  run: (database: Database) => Promise<unknown>
}

const NESTED_ERROR = /without callWriter\(\)\/callReader\(\)\. This deadlocks\./
const HANG_MS = 3000

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

class HangError extends Error {}

function withHangGuard<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const hang = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new HangError(`deadlocked (no result in ${HANG_MS}ms)`)),
      HANG_MS,
    )
  })
  return Promise.race([promise, hang]).finally(() => clearTimeout(timer))
}

let checksDatabase: Database | undefined

// Separate database file, so the checks never touch the notes, and so a regression (a real
// deadlock) only wedges this database's queue, not the app's.
function getChecksDatabase(): Database {
  if (!checksDatabase) {
    checksDatabase = new Database({
      adapter: new SQLiteAdapter({ schema, migrations, dbName: 'nitromelon-nested-checks' }),
      modelClasses: [Note],
      experimentalDetectNestedWriters: true,
    })
  }
  return checksDatabase
}

const createNote = (database: Database, title: string) =>
  database.get<Note>(NOTES_TABLE).create((note) => {
    note.title = title
    note.body = ''
    note.rank = 0
    note.pinned = false
  })

const CHECKS: Check[] = [
  {
    id: 'sync',
    label: 'Nested write, same turn',
    expect: 'deadlock-error',
    run: (db) =>
      db.write(async () => {
        await db.write(async () => 1)
      }),
  },
  {
    id: 'after-await',
    label: 'Nested write after await (#154 repro)',
    expect: 'deadlock-error',
    run: (db) =>
      db.write(async () => {
        await Promise.resolve()
        await db.write(async () => 1)
      }),
  },
  {
    id: 'after-timer',
    label: 'Nested write after a timer',
    expect: 'deadlock-error',
    run: (db) =>
      db.write(async () => {
        await delay(20)
        await db.write(async () => 1)
      }),
  },
  {
    id: 'after-network',
    label: 'Nested write after a network request',
    expect: 'deadlock-error',
    run: (db) =>
      db.write(async () => {
        // Whether this succeeds doesn't matter -- only that it's real native I/O
        await fetch('http://localhost:8081/status').catch(() => null)
        await db.write(async () => 1)
      }),
  },
  {
    id: 'deep-helper',
    label: 'Nested write deep in awaited helpers',
    expect: 'deadlock-error',
    run: (db) => {
      const save = async () => {
        await delay(5)
        return db.write(() => createNote(db, 'nested'), 'save')
      }
      const syncThenSave = async () => {
        await Promise.resolve()
        await delay(5)
        return save()
      }
      return db.write(async () => syncThenSave())
    },
  },
  {
    id: 'then-chain',
    label: 'Nested write in a .then() chain',
    expect: 'deadlock-error',
    run: (db) => db.write(() => delay(5).then(() => db.write(async () => 1))),
  },
  {
    id: 'returned',
    label: 'Nested write returned from writer',
    expect: 'deadlock-error',
    run: (db) =>
      db.write(async () => {
        await delay(5)
        return db.write(async () => 1)
      }),
  },
  {
    id: 'nested-read',
    label: 'Nested read in writer after await',
    expect: 'deadlock-error',
    run: (db) =>
      db.write(async () => {
        await delay(5)
        await db.read(async () => 1)
      }),
  },
  {
    id: 'after-db-ops',
    label: 'Nested write after create/update/fetch',
    expect: 'deadlock-error',
    run: (db) =>
      db.write(async () => {
        const note = await createNote(db, 'outer')
        await note.update((n) => {
          n.title = 'outer (updated)'
        })
        await db.get<Note>(NOTES_TABLE).query().fetch()
        await db.write(async () => 1)
      }),
  },
  {
    id: 'call-writer',
    label: 'callWriter()/callReader() after awaits',
    expect: 'ok',
    run: (db) =>
      db.write(async (writer) => {
        await delay(5)
        await writer.callWriter(() => db.write(() => createNote(db, 'via callWriter')))
        await Promise.resolve()
        return writer.callReader(() =>
          db.read(() => db.get<Note>(NOTES_TABLE).query().fetchCount()),
        )
      }),
  },
  {
    id: 'fire-and-forget',
    label: 'Writer queued without waiting for it',
    expect: 'ok',
    run: async (db) => {
      const order: string[] = []
      let nested: Promise<unknown> | undefined
      await db.write(async () => {
        await delay(5)
        nested = db.write(async () => {
          order.push('nested')
        })
        await delay(5)
        order.push('outer')
      })
      await nested
      if (order.join() !== 'outer,nested') throw new Error(`wrong order: ${order.join()}`)
    },
  },
  {
    id: 'independent',
    label: 'Independent writer queues meanwhile',
    expect: 'ok',
    run: async (db) => {
      let release: () => void = () => {}
      const first = db.write(async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      })
      await delay(10)
      // Started from outside the first writer, like a button press
      const second = db.write(async () => 'second')
      release()
      await Promise.all([first, second])
    },
  },
  {
    id: 'observer',
    label: 'Observer starts a writer on change',
    expect: 'ok',
    run: async (db) => {
      const reactions: Promise<unknown>[] = []
      const subscription = db.withChangesForTables([NOTES_TABLE]).subscribe((changes) => {
        if (changes) reactions.push(db.write(async () => 'reaction'))
      })
      try {
        await db.write(async () => {
          await delay(5)
          await createNote(db, 'observed')
        })
        await Promise.all(reactions)
        if (reactions.length !== 1) throw new Error(`expected 1 reaction, got ${reactions.length}`)
      } finally {
        subscription.unsubscribe()
      }
    },
  },
  {
    // Hermes can execute async functions natively (instead of Babel's generator transform) --
    // React Native doesn't do that by default yet. `new Function` source is compiled by Hermes
    // at runtime, untouched by Babel, so this shows whether detection survives native async.
    // Runs last: if it isn't detected, it deadlocks this database's queue.
    id: 'native-async',
    label: 'Native (non-Babel) async, informational',
    expect: 'deadlock-error',
    informational: true,
    run: (db) => {
      // eslint-disable-next-line no-new-func
      const makeWriter = new Function(
        'db',
        'return async () => { await Promise.resolve(); await db.write(async () => 1) }',
      ) as (db: Database) => () => Promise<unknown>
      return db.write(makeWriter(db))
    },
  },
]

async function runCheck(database: Database, check: Check): Promise<CheckResult> {
  const base = { id: check.id, label: check.label, informational: check.informational }
  try {
    await withHangGuard(check.run(database))
    return check.expect === 'ok'
      ? { ...base, status: 'pass', detail: 'ok' }
      : { ...base, status: 'fail', detail: 'resolved, expected a deadlock error' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof HangError) {
      return { ...base, status: 'fail', detail: message }
    }
    return check.expect === 'deadlock-error' && NESTED_ERROR.test(message)
      ? { ...base, status: 'pass', detail: 'threw deadlock error' }
      : { ...base, status: 'fail', detail: message }
  }
}

export function describeEngine(): string {
  const hermes = (
    globalThis as { HermesInternal?: { getRuntimeProperties?: () => Record<string, string> } }
  ).HermesInternal
  if (!hermes) return 'not Hermes'
  const version = hermes.getRuntimeProperties?.()['OSS Release Version']
  return version ? `Hermes ${version}` : 'Hermes'
}

export function describeContextTier(database: Database = getChecksDatabase()): string {
  // Private API -- for this diagnostics screen only
  const queue = (
    database as unknown as {
      _workQueue: { _getWorkContext(): { kind: string } | null }
    }
  )._workQueue
  return queue._getWorkContext()?.kind ?? 'none'
}

export async function runNestedWriterChecks(
  onResult: (result: CheckResult) => void,
): Promise<void> {
  const database = getChecksDatabase()
  await database.write(() => database.unsafeResetDatabase())
  let stuck = false
  for (const check of CHECKS) {
    if (stuck) {
      onResult({
        id: check.id,
        label: check.label,
        status: 'skipped',
        detail: 'queue is deadlocked by an earlier check',
        informational: check.informational,
      })
      continue
    }
    const result = await runCheck(database, check)
    stuck = result.detail.startsWith('deadlocked')
    onResult(result)
  }
}

export const NESTED_WRITER_CHECK_COUNT = CHECKS.length
