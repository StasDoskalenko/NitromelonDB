#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Turns the benchmark runner's JSONL from scripts/ci-benchmark-ios.sh (sync.jsonl, real.jsonl,
 * stress.jsonl: one line per run, NitromelonDB and WatermelonDB JSI interleaved) into the small
 * summary the PR comment and the `benchmarks` branch history store: the median of each metric
 * per library.
 *
 * Shared by scripts/post-ios-sync-comment.mjs and scripts/publish-perf-results.mjs, which read
 * the summary back with readIosSyncSummary().
 *
 * Usage:
 *   node scripts/ios-sync-summary.mjs <jsonlDir> <outFile> [--device <simulator name>]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const LIBRARIES = [
  { key: 'nitromelondb', label: 'NitromelonDB' },
  { key: 'watermelondb', label: 'WatermelonDB JSI' },
]

/**
 * The metrics we keep, in display order. `better` says which way is good, and which way round
 * the NitromelonDB vs WatermelonDB ratio goes.
 */
export const IOS_SYNC_METRICS = [
  { key: 'sync5kTotalMs', label: 'Sync 5k records, total', unit: 'ms', better: 'lower' },
  { key: 'sync50kInitialPullMs', label: 'Sync 50k: initial pull', unit: 'ms', better: 'lower' },
  { key: 'sync50kUpdatePullMs', label: 'Sync 50k: update pull', unit: 'ms', better: 'lower' },
  {
    key: 'sync50kFetchAllMs',
    label: 'Sync 50k: one fetch of all records',
    unit: 'ms',
    better: 'lower',
  },
  { key: 'sync50kPushMs', label: 'Sync 50k: push', unit: 'ms', better: 'lower' },
  { key: 'sync50kTotalMs', label: 'Sync 50k records, total', unit: 'ms', better: 'lower' },
  { key: 'sync50kGcMs', label: 'Sync 50k: JS GC time', unit: 'ms', better: 'lower' },
  {
    key: 'realisticLibraryMs',
    label: 'Realistic sync (300 pulls), library time',
    unit: 'ms',
    better: 'lower',
  },
  { key: 'stressScore', label: 'Stress test score', unit: 'ops/s', better: 'higher' },
  { key: 'stressWriteMs', label: 'Stress test: writes', unit: 'ms', better: 'lower' },
  { key: 'stressQueryMs', label: 'Stress test: queries', unit: 'ms', better: 'lower' },
  { key: 'stressDeleteMs', label: 'Stress test: deletes', unit: 'ms', better: 'lower' },
]

/**
 * CPU time of the app process while each card ran (user + system, all threads; run-sync-trials.mjs
 * reads it from the host). Time other VMs take from the runner adds wall time but not CPU time, so
 * this is steadier on CI. `ps` reports it in centiseconds, so short cards (Sync 5k) are coarse.
 */
export const IOS_SYNC_CPU_METRICS = [
  { key: 'sync5kCpuMs', label: 'Sync 5k records', unit: 'ms', better: 'lower' },
  { key: 'sync50kCpuMs', label: 'Sync 50k records', unit: 'ms', better: 'lower' },
  { key: 'realisticCpuMs', label: 'Realistic sync (300 pulls)', unit: 'ms', better: 'lower' },
  { key: 'stressCpuMs', label: 'Stress test', unit: 'ms', better: 'lower' },
]

/**
 * The overall speedup is the geometric mean of these ratios: one metric per workload, so the 50k
 * sync's sub-phases (which move together) don't outvote the others. A geometric mean, because the
 * ratios multiply: 2x faster on one and 2x slower on another averages to 1x, and NitromelonDB vs
 * WatermelonDB is exactly the inverse of WatermelonDB vs NitromelonDB.
 */
export const GEOMEAN_METRICS = [
  'sync5kTotalMs',
  'sync50kTotalMs',
  'realisticLibraryMs',
  'stressScore',
]

// Where each metric comes from: the runner's file, which runs, and the value in a run's line
const SOURCES = {
  sync5kTotalMs: ['sync', (r) => r.records === 5000, (r) => r.totalMs],
  sync50kInitialPullMs: ['sync', (r) => r.records === 50000, (r) => r.initialPullMs],
  sync50kUpdatePullMs: ['sync', (r) => r.records === 50000, (r) => r.updatePullMs],
  sync50kFetchAllMs: ['sync', (r) => r.records === 50000, (r) => r.fetchAllMs],
  sync50kPushMs: ['sync', (r) => r.records === 50000, (r) => r.pushMs],
  sync50kTotalMs: ['sync', (r) => r.records === 50000, (r) => r.totalMs],
  sync50kGcMs: ['sync', (r) => r.records === 50000, (r) => r.memory?.gcMs],
  realisticLibraryMs: ['real', () => true, (r) => r.libraryMs],
  stressScore: ['stress', (r) => !r.cancelled, (r) => r.score],
  stressWriteMs: ['stress', (r) => !r.cancelled, (r) => r.writeMs],
  stressQueryMs: ['stress', (r) => !r.cancelled, (r) => r.queryMs],
  stressDeleteMs: ['stress', (r) => !r.cancelled, (r) => r.deleteMs],
  sync5kCpuMs: ['sync', (r) => r.records === 5000, (r) => r.cpuMs],
  sync50kCpuMs: ['sync', (r) => r.records === 50000, (r) => r.cpuMs],
  realisticCpuMs: ['real', () => true, (r) => r.cpuMs],
  stressCpuMs: ['stress', (r) => !r.cancelled, (r) => r.cpuMs],
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}

/** How much faster NitromelonDB is than WatermelonDB for a metric (> 1 = faster), or null. */
export function speedup(metric, nitromelondb, watermelondb) {
  if (nitromelondb == null || watermelondb == null || nitromelondb <= 0 || watermelondb <= 0) {
    return null
  }
  return metric.better === 'higher' ? nitromelondb / watermelondb : watermelondb / nitromelondb
}

/** The geometric mean of NitromelonDB's speedups over GEOMEAN_METRICS, or null if one is missing. */
export function geomeanSpeedup(nitromelondb, watermelondb) {
  const ratios = GEOMEAN_METRICS.map((key) =>
    speedup(
      IOS_SYNC_METRICS.find((metric) => metric.key === key),
      nitromelondb?.[key],
      watermelondb?.[key],
    ),
  )
  if (ratios.some((ratio) => ratio == null)) return null
  return (
    Math.round(Math.exp(ratios.reduce((sum, r) => sum + Math.log(r), 0) / ratios.length) * 1000) /
    1000
  )
}

/** The best of the runner baselines (scripts/runner-baseline.mjs) saved in `dir`, or null. */
function readBaseline(dir) {
  const runs = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((file) => /^baseline.*\.json$/.test(file))
        .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
    : []
  if (runs.length === 0) return null
  return {
    jsMs: Math.min(...runs.map((run) => run.jsMs)),
    sqliteMs: Math.min(...runs.map((run) => run.sqliteMs)),
    cpu: runs[0].cpu,
    cores: runs[0].cores,
  }
}

const round = (value) => (value == null ? null : Math.round(value * 10) / 10)

export function summarizeIosSync(dir, device = null) {
  const files = Object.fromEntries(
    ['sync', 'real', 'stress'].map((card) => [card, readJsonl(path.join(dir, `${card}.jsonl`))]),
  )
  // Medians stay at the top level (what older history records have); `best` holds each app's best
  // run, which is what the comment and the charts compare: slowdowns from other VMs on a CI runner
  // only ever add time, so the best run is the closest to the real speed
  const summary = { device, best: {} }
  for (const { key: library, label } of LIBRARIES) {
    summary[library] = {}
    summary.best[library] = {}
    for (const metric of [...IOS_SYNC_METRICS, ...IOS_SYNC_CPU_METRICS]) {
      const [card, filter, value] = SOURCES[metric.key]
      const values = files[card]
        .filter((r) => r.label === label && filter(r))
        .map(value)
        .filter((v) => typeof v === 'number' && Number.isFinite(v))
      summary[library][metric.key] = round(median(values))
      const best =
        values.length === 0
          ? null
          : metric.better === 'higher'
            ? Math.max(...values)
            : Math.min(...values)
      summary.best[library][metric.key] = round(best)
    }
  }
  summary.geomean = {
    best: geomeanSpeedup(summary.best.nitromelondb, summary.best.watermelondb),
    median: geomeanSpeedup(summary.nitromelondb, summary.watermelondb),
  }
  summary.baseline = readBaseline(dir)
  // Runs per app (each app runs the same number of times; the runner interleaves them)
  const runsOf = (card, filter) =>
    files[card].filter((r) => r.label === LIBRARIES[0].label && filter(r)).length
  summary.runs = {
    sync: runsOf('sync', (r) => r.records === 50000),
    realistic: runsOf('real', () => true),
    stress: runsOf('stress', (r) => !r.cancelled),
  }
  return summary
}

/** The summary written by this script, or null when the file is missing (the job failed) or not JSON. */
export function readIosSyncSummary(file) {
  if (!file || !fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Throws unless every WatermelonDB run used its JSI adapter. Without its native module it silently
 * falls back to the asynchronous bridge adapter, which is ~2x slower and would flatter every ratio.
 * Runs record the engine the app reported (run-sync-trials.mjs --driver launch).
 */
export function checkEngines(dir) {
  const label = LIBRARIES.find((library) => library.key === 'watermelondb').label
  for (const card of ['sync', 'real', 'stress']) {
    for (const row of readJsonl(path.join(dir, `${card}.jsonl`))) {
      if (row.label === label && !/\(JSI\)/.test(row.engine ?? '')) {
        throw new Error(
          `${label} ran "${row.engine ?? 'an unknown engine'}" in ${card} run ${row.run}, not JSI`,
        )
      }
    }
  }
}

function main() {
  const [dir, outFile, ...rest] = process.argv.slice(2)
  if (!dir || !outFile) {
    console.error('Usage: node scripts/ios-sync-summary.mjs <jsonlDir> <outFile> [--device <name>]')
    process.exit(1)
  }
  checkEngines(dir)
  const deviceAt = rest.indexOf('--device')
  const summary = summarizeIosSync(dir, deviceAt >= 0 ? rest[deviceAt + 1] : null)
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify(summary, null, 2))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
