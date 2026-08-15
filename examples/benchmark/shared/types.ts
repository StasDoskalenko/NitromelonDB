import type { BenchmarkWorkload } from './config'

export type BenchmarkPhase = 'idle' | 'reset' | 'write' | 'query' | 'delete' | 'done' | 'error'

export type QueryBreakdown = {
  countAll: number
  countFiltered: number
  fetchFiltered: number
  fetchPage: number
  countHigh: number
}

export type RoundResult = {
  round: number
  writeMs: number
  queryMs: number
  deleteMs: number
  totalMs: number
  queries: QueryBreakdown
}

export type BenchmarkProgress = {
  phase: BenchmarkPhase
  round: number
  rounds: number
  records: number
  phaseDone: number
  phaseTotal: number
  elapsedMs: number
  roundsCompleted: RoundResult[]
  error?: string
}

export type BenchmarkSummary = {
  label: string
  engine: string
  records: number
  rounds: number
  completedRounds: number
  cancelled: boolean
  totalMs: number
  writeMs: number
  queryMs: number
  deleteMs: number
  writesPerSec: number
  deletesPerSec: number
  opsPerSec: number
  score: number
  fastestRoundMs: number
  slowestRoundMs: number
  rounds: RoundResult[]
}

export type BenchmarkAdapter = {
  label: string
  engine: string
  reset(): Promise<void>
  insertBatch(startIndex: number, count: number): Promise<void>
  runQueries(): Promise<QueryBreakdown>
  deleteBatch(count: number): Promise<number>
}

export type BenchmarkCancel = {
  cancelled: boolean
}

export type ProgressListener = (progress: BenchmarkProgress) => void

export type RunBenchmarkOptions = {
  adapter: BenchmarkAdapter
  workload: BenchmarkWorkload
  onProgress: ProgressListener
  cancel: BenchmarkCancel
}
