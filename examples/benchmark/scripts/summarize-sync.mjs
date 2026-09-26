#!/usr/bin/env node
// Summarizes run-sync-trials.mjs output as Markdown.
//
//   node scripts/summarize-sync.mjs results.jsonl [--baseline 'Label']
//
// Per size:
//   1. every config: median, with IQR (25th–75th percentile) and min–max underneath
//   2. with --baseline: every other config against it. For each metric: the difference in medians,
//      its bootstrap 95% confidence interval, and a two-sided Mann-Whitney U p-value. A difference
//      whose CI includes 0 (or p > 0.05) is not distinguishable from noise with this many runs.
//
// Incremental sync rows (--card incr) are grouped by records per table instead, with per-pull
// medians by pull size and the total of all pulls, without and with observers.
//
// Timings are wall clock, so they include GC pauses. "Total − GC" subtracts the Hermes GC time
// recorded in the same run. It's a rough view of the work itself, since some GC runs concurrently
// and doesn't block JS.

import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const file = argv[0]
const baselineAt = argv.indexOf('--baseline')
const baseline = baselineAt >= 0 ? argv[baselineAt + 1] : null

const rows = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))

const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}
const sortedNumbers = (values) => values.filter((v) => typeof v === 'number').sort((a, b) => a - b)
const median = (values) => quantile(sortedNumbers(values), 0.5)

// Deterministic PRNG so the same input always prints the same CIs
let seed = 42
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
const resample = (values) => values.map(() => values[Math.floor(random() * values.length)])

function bootstrapMedianDiffCI(a, b, iterations = 10000) {
  const diffs = []
  for (let i = 0; i < iterations; i += 1) {
    diffs.push(median(resample(b)) - median(resample(a)))
  }
  diffs.sort((x, y) => x - y)
  return [quantile(diffs, 0.025), quantile(diffs, 0.975)]
}

// Two-sided Mann-Whitney U, normal approximation with tie correction
function mannWhitneyP(a, b) {
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v)
  const ranks = new Array(all.length)
  let tieTerm = 0
  for (let i = 0; i < all.length; ) {
    let j = i
    while (j + 1 < all.length && all[j + 1].v === all[i].v) {
      j += 1
    }
    const rank = (i + j) / 2 + 1
    for (let k = i; k <= j; k += 1) {
      ranks[k] = rank
    }
    const t = j - i + 1
    tieTerm += t ** 3 - t
    i = j + 1
  }
  const n1 = a.length
  const n2 = b.length
  const r1 = all.reduce((sum, item, i) => (item.g === 0 ? sum + ranks[i] : sum), 0)
  const u = r1 - (n1 * (n1 + 1)) / 2
  const mean = (n1 * n2) / 2
  const n = n1 + n2
  const sd = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1))))
  if (sd === 0) {
    return 1
  }
  const z = (Math.abs(u - mean) - 0.5) / sd
  return Math.min(1, 2 * (1 - normalCdf(z)))
}

function normalCdf(z) {
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2))
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

const ms = (value) => `${Math.round(value)}`
const ms1 = (value) => `${value.toFixed(1)}`
const mb = (value) => `${(value / 1048576).toFixed(0)}`
const mb1 = (value) => `${(value / 1048576).toFixed(1)}`

const incremental = rows.some((r) => r.kind === 'incremental')

const syncMetrics = [
  ['Initial ms', (r) => r.initialPullMs, ms],
  ['Update ms', (r) => r.updatePullMs, ms],
  ['Fetch ms', (r) => r.fetchAllMs, ms],
  ['Push ms', (r) => r.pushMs, ms],
  ['Total ms', (r) => r.totalMs, ms],
  ['GC ms', (r) => r.memory?.gcMs, ms],
  ['Total − GC ms', (r) => (r.memory ? r.totalMs - r.memory.gcMs : undefined), ms],
  ['JS heap peak MB', (r) => r.memory?.heapPeakBytes, mb],
  ['JS allocated peak MB', (r) => r.memory?.allocatedPeakBytes, mb1],
  ['RSS peak MB', (r) => r.rssPeakBytes, mb],
]
const syncCompared = ['Initial ms', 'Update ms', 'Fetch ms', 'Total ms', 'GC ms', 'Total − GC ms', 'JS allocated peak MB', 'RSS peak MB']

const incrementalMetrics = [
  ['All pulls ms', (r) => r.plain.totalMs, ms],
  ['Empty pull ms', (r) => r.plain.empty.medianMs, ms1],
  ['1–99 ms', (r) => r.plain.small.medianMs, ms1],
  ['100–999 ms', (r) => r.plain.medium.medianMs, ms1],
  ['1,000+ ms', (r) => r.plain.large.medianMs, ms],
  ['Observed: all pulls ms', (r) => r.observed.totalMs, ms],
  ['Observed: empty ms', (r) => r.observed.empty.medianMs, ms1],
  ['Observed: 1–99 ms', (r) => r.observed.small.medianMs, ms1],
  ['Observed: 100–999 ms', (r) => r.observed.medium.medianMs, ms1],
  ['Observed: 1,000+ ms', (r) => r.observed.large.medianMs, ms],
  ['Seed ms', (r) => r.seedMs, ms],
  ['RSS peak MB', (r) => r.rssPeakBytes, mb],
]

const metrics = incremental ? incrementalMetrics : syncMetrics
const compared = incremental ? incrementalMetrics.map(([name]) => name) : syncCompared
const sizeOf = (r) => (incremental ? r.seedPerTable : r.records)

const labels = [...new Set(rows.map((r) => r.label))]
const sizes = [...new Set(rows.map(sizeOf))].sort((a, b) => a - b)

for (const size of sizes) {
  console.log(`\n### ${size.toLocaleString('en-US')} ${incremental ? 'records per table' : 'records'}\n`)
  console.log(`| | runs | ${metrics.map(([name]) => name).join(' | ')} |`)
  console.log(`|---|---|${metrics.map(() => '---').join('|')}|`)
  for (const label of labels) {
    const group = rows.filter((r) => r.label === label && sizeOf(r) === size)
    if (!group.length) {
      continue
    }
    const cells = metrics.map(([, pick, format]) => {
      const values = sortedNumbers(group.map(pick))
      if (!values.length) {
        return '—'
      }
      const iqr = `${format(quantile(values, 0.25))}–${format(quantile(values, 0.75))}`
      const range = `${format(values[0])}–${format(values[values.length - 1])}`
      return `**${format(quantile(values, 0.5))}**<br><sub>IQR ${iqr}<br>range ${range}</sub>`
    })
    console.log(`| ${label} | ${group.length} | ${cells.join(' | ')} |`)
  }

  if (!baseline) {
    continue
  }
  const base = rows.filter((r) => r.label === baseline && sizeOf(r) === size)
  if (!base.length) {
    continue
  }
  console.log(`\nAgainst **${baseline}** (median difference, bootstrap 95% CI, Mann-Whitney p):\n`)
  console.log(`| | ${compared.join(' | ')} |`)
  console.log(`|---|${compared.map(() => '---').join('|')}|`)
  for (const label of labels) {
    if (label === baseline) {
      continue
    }
    const group = rows.filter((r) => r.label === label && sizeOf(r) === size)
    if (!group.length) {
      continue
    }
    const cells = compared.map((name) => {
      const [, pick, format] = metrics.find(([metric]) => metric === name)
      const a = sortedNumbers(base.map(pick))
      const b = sortedNumbers(group.map(pick))
      if (!a.length || !b.length) {
        return '—'
      }
      const diff = quantile(b, 0.5) - quantile(a, 0.5)
      const [lo, hi] = bootstrapMedianDiffCI(a, b)
      const pct = (diff / quantile(a, 0.5)) * 100
      const p = mannWhitneyP(a, b)
      const sign = (value) => (value > 0 ? `+${format(value)}` : format(value))
      const significant = p < 0.05 && (lo > 0 || hi < 0)
      const text = `${sign(diff)} (${pct > 0 ? '+' : ''}${pct.toFixed(0)}%)<br><sub>CI ${sign(lo)}…${sign(hi)}, p=${p < 0.001 ? '<0.001' : p.toFixed(3)}</sub>`
      return significant ? `**${text}**` : text
    })
    console.log(`| ${label} | ${cells.join(' | ')} |`)
  }
}
