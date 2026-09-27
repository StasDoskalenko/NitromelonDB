// "Competing writers/readers" workload, shared by both benchmark apps.
//
// Real apps rarely have a single call site driving the database. A periodic sync timer, a
// realtime push handler, a manual pull-to-refresh, and a few on-screen queries/observers all
// call `database.write()`/`database.read()` independently, with no idea any of the others
// exist -- they all just compete for the same Writer/Reader queue. That's exactly the shape
// that used to spam "The writer/reader you're trying to run (unnamed) can't be performed yet"
// (see WorkQueue.ts): several unrelated, unnamed callers piling up behind whichever one happens
// to be running.
//
// This benchmark reproduces that directly: `writerCallers` + `readerCallers` independent
// "actors" (no shared coordination, only a couple intentionally left unnamed -- realistically,
// most real call sites never bother to pass a description either) each fire `opsPerCaller`
// write()/read() calls back-to-back, all at once, against the same Database. `workMs` stands in
// for real work (an adapter round trip) so the queue actually builds up the way it would with
// real I/O, not an instant no-op.
//
// Counting warnings is the caller's job (see withWarningCount() below) -- each app links its
// own copy of the library (nitromelondb vs @nozbe/watermelondb), each with its own internal
// `logger` singleton, so there's no single import to spy on.

export type CompetingWorkDatabase = {
  write<T>(work: () => Promise<T>, description?: string): Promise<T>
  read<T>(work: () => Promise<T>): Promise<T>
}

export type CompetingWorkOptions = {
  writerCallers: number
  readerCallers: number
  opsPerCaller: number
  // How long each writer/reader's own body takes, simulating real (adapter) work.
  workMs: number
}

export type CompetingWorkResult = {
  options: CompetingWorkOptions
  totalOps: number
  totalMs: number
  opsPerSec: number
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Every 3rd writer caller and every 3rd reader caller runs with no description at all -- most
// real call sites (a plain `database.write(async () => {...})` somewhere in app code) never
// pass one either, and that's the case the "unnamed"/stuck-detector naming fallback exists for.
function callerDescription(kind: 'writer' | 'reader', index: number): string | undefined {
  return index % 3 === 0 ? undefined : `competing-${kind}-${index}`
}

export async function runCompetingWorkBenchmark(
  database: CompetingWorkDatabase,
  options: CompetingWorkOptions,
): Promise<CompetingWorkResult> {
  const started = now()
  const actors: Promise<unknown>[] = []

  for (let index = 0; index < options.writerCallers; index += 1) {
    const description = callerDescription('writer', index)
    actors.push(
      (async () => {
        for (let op = 0; op < options.opsPerCaller; op += 1) {
          // eslint-disable-next-line no-await-in-loop -- each op must wait its turn in the queue
          await database.write(() => sleep(options.workMs), description)
        }
      })(),
    )
  }

  for (let index = 0; index < options.readerCallers; index += 1) {
    actors.push(
      (async () => {
        for (let op = 0; op < options.opsPerCaller; op += 1) {
          // eslint-disable-next-line no-await-in-loop
          await database.read(() => sleep(options.workMs))
        }
      })(),
    )
  }

  await Promise.all(actors)
  const totalMs = now() - started
  const totalOps = (options.writerCallers + options.readerCallers) * options.opsPerCaller

  return {
    options,
    totalOps,
    totalMs,
    opsPerSec: totalMs > 0 ? totalOps / (totalMs / 1000) : 0,
  }
}

// Counts the library's dev-mode queue-contention warnings while `run` executes. Both
// NitromelonDB and upstream WatermelonDB emit theirs through `logger.warn()`, which itself just
// calls `console.warn(...)` -- spying on `console.warn` directly (rather than importing either
// library's internal `logger`) is what makes this portable across both, and across RN/Node.
export async function withWarningCount<T>(
  run: () => Promise<T>,
): Promise<{ result: T; warnings: number; messages: string[] }> {
  const messages: string[] = []
  // eslint-disable-next-line no-console
  const original = console.warn
  // eslint-disable-next-line no-console
  console.warn = (...args: unknown[]) => {
    messages.push(args.map((arg) => String(arg)).join(' '))
  }
  try {
    const result = await run()
    return { result, warnings: messages.length, messages }
  } finally {
    // eslint-disable-next-line no-console
    console.warn = original
  }
}
