export type BenchmarkWorkload = {
  records: number
  rounds: number
  batchSize: number
}

/** Full comparison run: 1M writes, queries, 1M deletes, 20 times. */
export const FULL_WORKLOAD: BenchmarkWorkload = {
  records: 1_000_000,
  rounds: 20,
  batchSize: 2_500,
}

/** Repeatable comparison run: large enough to dampen warmup noise. */
export const QUICK_WORKLOAD: BenchmarkWorkload = {
  records: 100_000,
  rounds: 10,
  batchSize: 2_500,
}
