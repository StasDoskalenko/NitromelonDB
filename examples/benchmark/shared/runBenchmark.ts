import type { BenchmarkWorkload } from './config'
import type {
  BenchmarkAdapter,
  BenchmarkCancel,
  BenchmarkProgress,
  BenchmarkSummary,
  ProgressListener,
  RoundResult,
} from './types'

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function rate(count: number, ms: number): number {
  if (ms <= 0) {
    return 0
  }
  return (count * 1000) / ms
}

function summarize(
  adapter: BenchmarkAdapter,
  workload: BenchmarkWorkload,
  rounds: RoundResult[],
  totalMs: number,
  cancelled: boolean,
): BenchmarkSummary {
  const writeMs = rounds.reduce((sum, round) => sum + round.writeMs, 0)
  const queryMs = rounds.reduce((sum, round) => sum + round.queryMs, 0)
  const deleteMs = rounds.reduce((sum, round) => sum + round.deleteMs, 0)
  const completed = rounds.length
  const written = completed * workload.records
  const deleted = completed * workload.records
  const queryOps = completed * 5
  const ops = written + deleted + queryOps
  const totals = rounds.map((round) => round.totalMs)

  return {
    label: adapter.label,
    engine: adapter.engine,
    records: workload.records,
    rounds: workload.rounds,
    completedRounds: completed,
    cancelled,
    totalMs,
    writeMs,
    queryMs,
    deleteMs,
    writesPerSec: rate(written, writeMs),
    deletesPerSec: rate(deleted, deleteMs),
    opsPerSec: rate(ops, totalMs),
    score: Math.round(rate(written + deleted, totalMs)),
    fastestRoundMs: totals.length ? Math.min(...totals) : 0,
    slowestRoundMs: totals.length ? Math.max(...totals) : 0,
    rounds,
  }
}

export async function runBenchmark(
  adapter: BenchmarkAdapter,
  workload: BenchmarkWorkload,
  onProgress: ProgressListener,
  cancel: BenchmarkCancel,
): Promise<BenchmarkSummary> {
  const started = now()
  const roundsCompleted: RoundResult[] = []

  const emit = (
    partial: Omit<BenchmarkProgress, 'elapsedMs' | 'roundsCompleted' | 'records' | 'rounds'>,
  ) => {
    onProgress({
      ...partial,
      records: workload.records,
      rounds: workload.rounds,
      elapsedMs: now() - started,
      roundsCompleted: [...roundsCompleted],
    })
  }

  const throwIfCancelled = () => {
    if (cancel.cancelled) {
      const error = new Error('Benchmark cancelled')
      error.name = 'BenchmarkCancelled'
      throw error
    }
  }

  try {
    emit({ phase: 'reset', round: 0, phaseDone: 0, phaseTotal: 1 })
    await adapter.reset()
    await yieldToUI()
    throwIfCancelled()

    for (let round = 1; round <= workload.rounds; round += 1) {
      throwIfCancelled()
      emit({ phase: 'write', round, phaseDone: 0, phaseTotal: workload.records })

      const writeStarted = now()
      for (let written = 0; written < workload.records; written += workload.batchSize) {
        throwIfCancelled()
        const count = Math.min(workload.batchSize, workload.records - written)
        await adapter.insertBatch(written, count)
        emit({
          phase: 'write',
          round,
          phaseDone: written + count,
          phaseTotal: workload.records,
        })
        await yieldToUI()
      }
      const writeMs = now() - writeStarted

      emit({ phase: 'query', round, phaseDone: 0, phaseTotal: 1 })
      const queryStarted = now()
      const queries = await adapter.runQueries()
      const queryMs = now() - queryStarted
      emit({ phase: 'query', round, phaseDone: 1, phaseTotal: 1 })
      await yieldToUI()
      throwIfCancelled()

      emit({ phase: 'delete', round, phaseDone: 0, phaseTotal: workload.records })
      const deleteStarted = now()
      let deleted = 0
      while (deleted < workload.records) {
        throwIfCancelled()
        const removed = await adapter.deleteBatch(
          Math.min(workload.batchSize, workload.records - deleted),
        )
        if (removed === 0) {
          break
        }
        deleted += removed
        emit({
          phase: 'delete',
          round,
          phaseDone: Math.min(deleted, workload.records),
          phaseTotal: workload.records,
        })
        await yieldToUI()
      }
      const deleteMs = now() - deleteStarted

      roundsCompleted.push({
        round,
        writeMs,
        queryMs,
        deleteMs,
        totalMs: writeMs + queryMs + deleteMs,
        queries,
      })
    }

    const summary = summarize(adapter, workload, roundsCompleted, now() - started, false)
    emit({ phase: 'done', round: workload.rounds, phaseDone: 1, phaseTotal: 1 })
    return summary
  } catch (error) {
    const cancelled = error instanceof Error && error.name === 'BenchmarkCancelled'
    if (cancelled) {
      const summary = summarize(adapter, workload, roundsCompleted, now() - started, true)
      emit({ phase: 'done', round: roundsCompleted.length, phaseDone: 1, phaseTotal: 1 })
      return summary
    }
    const message = error instanceof Error ? error.message : String(error)
    emit({
      phase: 'error',
      round: roundsCompleted.length,
      phaseDone: 0,
      phaseTotal: 1,
      error: message,
    })
    throw error
  }
}
