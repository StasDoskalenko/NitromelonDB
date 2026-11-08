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

export function summarizeIosSync(dir, device = null) {
  const files = Object.fromEntries(
    ['sync', 'real', 'stress'].map((card) => [card, readJsonl(path.join(dir, `${card}.jsonl`))]),
  )
  const summary = { device }
  for (const { key: library, label } of LIBRARIES) {
    summary[library] = {}
    for (const metric of IOS_SYNC_METRICS) {
      const [card, filter, value] = SOURCES[metric.key]
      const values = files[card]
        .filter((r) => r.label === label && filter(r))
        .map(value)
        .filter((v) => typeof v === 'number' && Number.isFinite(v))
      const m = median(values)
      summary[library][metric.key] = m == null ? null : Math.round(m * 10) / 10
    }
  }
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
        throw new Error(`${label} ran "${row.engine ?? 'an unknown engine'}" in ${card} run ${row.run}, not JSI`)
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
