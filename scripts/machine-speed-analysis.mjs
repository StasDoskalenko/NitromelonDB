#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * How well the machine-speed sampler (scripts/machine-sampler, run alongside every run by
 * run-sync-trials.mjs --sampler, recorded on each row as `machine`) tracks the iOS benchmark's
 * run-to-run swings within one CI job.
 *
 * Per workload:
 * - WatermelonDB 0.28 never changes, so its swings within a job are the machine's. `r` is the
 *   correlation of its speed (1/time, or the score) with the sampler's (1/cpuUs, 1/fsyncUs), on
 *   logs: 1 = the sampler explains them, 0 = unrelated.
 * - The slope (fitted on WatermelonDB, on logs) says how strongly the app's speed follows the
 *   sampler's: 0.5 = a 10% slower sampler means a ~5% slower run. Each run is adjusted to the
 *   job's median sampler speed with it: value x (sampler speed / median)^slope (a score divided).
 * - Run-to-run variation (cv) of both apps as measured, adjusted 1:1 and with the fitted slope,
 *   and NitromelonDB's as its speedup over the WatermelonDB run next to it (paired). The slope is
 *   fitted on WatermelonDB, so NitromelonDB's adjusted cv is the fair test; WatermelonDB's is
 *   optimistic by construction.
 *
 * Usage: node scripts/machine-speed-analysis.mjs <jsonlDir> [outFile]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SIGNALS = [
  { key: 'cpu', value: (machine) => machine?.cpuUs },
  { key: 'fsync', value: (machine) => machine?.fsyncUs },
]

const WORKLOADS = [
  {
    key: 'sync5kTotalMs',
    card: 'sync',
    filter: (r) => r.records === 5000,
    value: (r) => r.totalMs,
    better: 'lower',
  },
  {
    key: 'sync50kTotalMs',
    card: 'sync',
    filter: (r) => r.records === 50000,
    value: (r) => r.totalMs,
    better: 'lower',
  },
  {
    key: 'realisticLibraryMs',
    card: 'real',
    filter: () => true,
    value: (r) => r.libraryMs,
    better: 'lower',
  },
  {
    key: 'stressScore',
    card: 'stress',
    filter: (r) => !r.cancelled,
    value: (r) => r.score,
    better: 'higher',
  },
]

const LABELS = { nitromelondb: 'NitromelonDB', watermelondb: 'WatermelonDB JSI' }

function readJsonl(file) {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const median = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const cv = (xs) =>
  xs.length < 2 ? null : Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2))) / mean(xs)
const round3 = (value) =>
  value == null || !Number.isFinite(value) ? null : Math.round(value * 1000) / 1000

/** Correlation and least-squares slope of ys on xs. */
function fit(xs, ys) {
  if (xs.length < 3) return { r: null, slope: null }
  const mx = mean(xs)
  const my = mean(ys)
  const sxy = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0)
  const sxx = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0)
  const syy = ys.reduce((sum, y) => sum + (y - my) ** 2, 0)
  if (!(sxx > 0) || !(syy > 0)) return { r: null, slope: null }
  return { r: sxy / Math.sqrt(sxx * syy), slope: sxy / sxx }
}

export function analyzeMachineSpeed(dir) {
  const files = Object.fromEntries(
    ['sync', 'real', 'stress'].map((card) => [card, readJsonl(path.join(dir, `${card}.jsonl`))]),
  )
  const sampled = Object.values(files)
    .flat()
    .filter((r) => r.machine?.cpuUs > 0)
  if (sampled.length === 0) return null
  const workloads = {}
  for (const workload of WORKLOADS) {
    const runs = (library) =>
      new Map(
        files[workload.card]
          .filter((r) => r.label === LABELS[library] && workload.filter(r))
          .map((r) => [r.run, { value: workload.value(r), machine: r.machine }])
          .filter(([, r]) => r.value > 0),
      )
    const n = runs('nitromelondb')
    const w = runs('watermelondb')
    const rounds = [...n.keys()].filter((round) => w.has(round))
    if (rounds.length < 3) continue
    const speed = (value) => (workload.better === 'higher' ? value : 1 / value)
    // value at the median machine speed: a time multiplied by (machine speed ratio)^slope
    const adjust = (value, ratio, slope) =>
      workload.better === 'higher' ? value / ratio ** slope : value * ratio ** slope
    const result = {
      runs: rounds.length,
      watermelondb: { cv: round3(cv(rounds.map((r) => w.get(r).value))) },
      nitromelondb: {
        cv: round3(cv(rounds.map((r) => n.get(r).value))),
        cvPaired: round3(cv(rounds.map((r) => n.get(r).value / w.get(r).value))),
      },
      signals: {},
    }
    for (const signal of SIGNALS) {
      const usable = rounds.filter(
        (r) => signal.value(n.get(r).machine) > 0 && signal.value(w.get(r).machine) > 0,
      )
      if (usable.length < 3) continue
      const machineSpeed = (run) => 1 / signal.value(run.machine)
      const usual = median(usable.flatMap((r) => [machineSpeed(w.get(r)), machineSpeed(n.get(r))]))
      const { r, slope } = fit(
        usable.map((round) => Math.log(machineSpeed(w.get(round)))),
        usable.map((round) => Math.log(speed(w.get(round).value))),
      )
      const adjusted = (runsOf, s) =>
        round3(
          cv(
            usable.map((round) =>
              adjust(runsOf.get(round).value, machineSpeed(runsOf.get(round)) / usual, s),
            ),
          ),
        )
      result.signals[signal.key] = {
        r: round3(r),
        slope: round3(slope),
        machineCv: round3(
          cv(usable.flatMap((round) => [machineSpeed(w.get(round)), machineSpeed(n.get(round))])),
        ),
        watermelondb: {
          cvAdjusted1to1: adjusted(w, 1),
          cvAdjustedFitted: slope == null ? null : adjusted(w, slope),
        },
        nitromelondb: {
          cvAdjusted1to1: adjusted(n, 1),
          cvAdjustedFitted: slope == null ? null : adjusted(n, slope),
        },
      }
    }
    workloads[workload.key] = result
  }
  return { sampledRuns: sampled.length, workloads }
}

function printTable(analysis) {
  const pct = (v) => (v == null ? '  –  ' : `${(v * 100).toFixed(1)}%`)
  const num = (v) => (v == null ? '–' : v.toFixed(2))
  console.log(`Machine-speed sampler on ${analysis.sampledRuns} runs`)
  for (const [key, w] of Object.entries(analysis.workloads)) {
    console.log(`\n${key} (${w.runs} pairs)`)
    console.log(
      `  measured cv: WatermelonDB ${pct(w.watermelondb.cv)}, NitromelonDB ${pct(w.nitromelondb.cv)}; NitromelonDB paired ${pct(w.nitromelondb.cvPaired)}`,
    )
    for (const [signal, s] of Object.entries(w.signals)) {
      console.log(
        `  ${signal.padEnd(5)}: sampler cv ${pct(s.machineCv)}, r with WatermelonDB ${num(s.r)}, slope ${num(s.slope)} | ` +
          `WatermelonDB adjusted 1:1 ${pct(s.watermelondb.cvAdjusted1to1)}, fitted ${pct(s.watermelondb.cvAdjustedFitted)} | ` +
          `NitromelonDB adjusted 1:1 ${pct(s.nitromelondb.cvAdjusted1to1)}, fitted ${pct(s.nitromelondb.cvAdjustedFitted)}`,
      )
    }
  }
}

function main() {
  const [dir, outFile] = process.argv.slice(2)
  if (!dir) {
    console.error('Usage: node scripts/machine-speed-analysis.mjs <jsonlDir> [outFile]')
    process.exit(1)
  }
  const analysis = analyzeMachineSpeed(dir)
  if (!analysis) {
    console.log('No machine-speed samples recorded')
    return
  }
  printTable(analysis)
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(analysis, null, 2) + '\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
