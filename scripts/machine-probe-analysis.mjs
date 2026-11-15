#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * How well the machine probe (scripts/machine-probe.mjs, taken before the first round and after
 * every round) tracks the iOS benchmark's run-to-run swings within one CI job, part by part.
 *
 * Each run gets the probe around its round: the geometric mean of the probes just before and just
 * after it. Then, per workload:
 * - WatermelonDB 0.28 never changes, so its swings within a job are the machine's. `r` is the
 *   correlation of its speed (1/time, or the score) with each probe part, on logs: 1 = the part
 *   explains them, 0 = unrelated. `cv` is its run-to-run variation as measured and adjusted by the
 *   part (each time multiplied by the part's value / its median in the job, a score divided).
 * - NitromelonDB: run-to-run variation as measured, adjusted by each part, and as its speedup over
 *   the WatermelonDB run next to it (paired, scripts/ios-sync-summary.mjs). The lower, the better
 *   the method removes the machine.
 * A handful of rounds per card (5 for the stress test), so one job's r is rough; it's recorded in
 * the summary so jobs can be compared.
 *
 * Usage: node scripts/machine-probe-analysis.mjs <jsonlDir> [outFile]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROBE_PARTS = [
  'cpu1Mips',
  'cpuAllMips',
  'memMiBps',
  'fsyncIops',
  'randReadIops',
  'gpuGflops',
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

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const cv = (xs) =>
  xs.length < 2 ? null : Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2))) / mean(xs)

function correlation(xs, ys) {
  if (xs.length < 3) return null
  const mx = mean(xs)
  const my = mean(ys)
  const sxy = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0)
  const sxx = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0)
  const syy = ys.reduce((sum, y) => sum + (y - my) ** 2, 0)
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null
}

const round3 = (value) => (value == null ? null : Math.round(value * 1000) / 1000)

/** The probe around each round of a card: geometric mean of the probes before and after it. */
function probesByRound(probes, card) {
  const byRound = new Map(probes.filter((p) => p.card === card).map((p) => [p.round, p]))
  return (round) => {
    const around = [byRound.get(round - 1), byRound.get(round)].filter(Boolean)
    if (around.length === 0) return null
    return Object.fromEntries(
      PROBE_PARTS.map((part) => {
        const values = around.map((p) => p[part]).filter((v) => v > 0)
        return [part, values.length ? Math.exp(mean(values.map(Math.log))) : null]
      }),
    )
  }
}

export function analyzeProbes(dir) {
  const probes = readJsonl(path.join(dir, 'probes.jsonl'))
  if (probes.length === 0) return null
  const files = Object.fromEntries(
    ['sync', 'real', 'stress'].map((card) => [card, readJsonl(path.join(dir, `${card}.jsonl`))]),
  )
  const workloads = {}
  for (const workload of WORKLOADS) {
    const around = probesByRound(probes, workload.card)
    const runs = (library) =>
      new Map(
        files[workload.card]
          .filter((r) => r.label === LABELS[library] && workload.filter(r))
          .map((r) => [r.run, { value: workload.value(r), probe: around(r.run) }])
          .filter(([, r]) => r.value > 0 && r.probe),
      )
    const n = runs('nitromelondb')
    const w = runs('watermelondb')
    const rounds = [...n.keys()].filter((round) => w.has(round))
    if (rounds.length < 3) continue
    // Speed: higher = faster, for correlating with the probe
    const speed = (value) => (workload.better === 'higher' ? value : 1 / value)
    const adjust = (value, ratio) => (workload.better === 'higher' ? value / ratio : value * ratio)
    const result = {
      rounds: rounds.length,
      watermelondb: { cv: round3(cv(rounds.map((r) => w.get(r).value))), r: {}, cvAdjusted: {} },
      nitromelondb: {
        cv: round3(cv(rounds.map((r) => n.get(r).value))),
        cvPaired: round3(cv(rounds.map((r) => n.get(r).value / w.get(r).value))),
        cvAdjusted: {},
      },
    }
    for (const part of PROBE_PARTS) {
      const usable = rounds.filter((r) => n.get(r).probe[part] > 0 && w.get(r).probe[part] > 0)
      if (usable.length < 3) continue
      const usual = median(usable.map((r) => w.get(r).probe[part]))
      result.watermelondb.r[part] = round3(
        correlation(
          usable.map((r) => Math.log(speed(w.get(r).value))),
          usable.map((r) => Math.log(w.get(r).probe[part])),
        ),
      )
      for (const library of ['watermelondb', 'nitromelondb']) {
        const values = library === 'watermelondb' ? w : n
        result[library].cvAdjusted[part] = round3(
          cv(usable.map((r) => adjust(values.get(r).value, values.get(r).probe[part] / usual))),
        )
      }
    }
    workloads[workload.key] = result
  }
  const medians = Object.fromEntries(
    PROBE_PARTS.map((part) => {
      const values = probes.map((p) => p[part]).filter((v) => v > 0)
      return [part, values.length ? Math.round(median(values) * 10) / 10 : null]
    }),
  )
  const spread = Object.fromEntries(
    PROBE_PARTS.map((part) => [part, round3(cv(probes.map((p) => p[part]).filter((v) => v > 0)))]),
  )
  return { samples: probes.length, medians, cv: spread, workloads }
}

function printTable(analysis) {
  const pct = (v) => (v == null ? '   –  ' : `${(v * 100).toFixed(1).padStart(5)}%`)
  const num = (v) => (v == null ? '   – ' : v.toFixed(2).padStart(5))
  console.log(`Machine probe: ${analysis.samples} samples. Variation of each part over the job:`)
  console.log('  ' + PROBE_PARTS.map((part) => `${part} ${pct(analysis.cv[part])}`).join('  '))
  for (const [key, w] of Object.entries(analysis.workloads)) {
    console.log(`\n${key} (${w.rounds} rounds)`)
    console.log(
      `  WatermelonDB: r with each part: ${PROBE_PARTS.map((p) => `${p} ${num(w.watermelondb.r[p])}`).join('  ')}`,
    )
    console.log(
      `  WatermelonDB cv: measured ${pct(w.watermelondb.cv)} | adjusted by ${PROBE_PARTS.map((p) => `${p} ${pct(w.watermelondb.cvAdjusted[p])}`).join('  ')}`,
    )
    console.log(
      `  NitromelonDB cv: measured ${pct(w.nitromelondb.cv)} | paired with WatermelonDB ${pct(w.nitromelondb.cvPaired)} | adjusted by ${PROBE_PARTS.map((p) => `${p} ${pct(w.nitromelondb.cvAdjusted[p])}`).join('  ')}`,
    )
  }
}

function main() {
  const [dir, outFile] = process.argv.slice(2)
  if (!dir) {
    console.error('Usage: node scripts/machine-probe-analysis.mjs <jsonlDir> [outFile]')
    process.exit(1)
  }
  const analysis = analyzeProbes(dir)
  if (!analysis) {
    console.log('No machine probes recorded')
    return
  }
  printTable(analysis)
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(analysis, null, 2) + '\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
