#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Upsert one PR comment with the iOS sync benchmark (scripts/ci-benchmark-ios.sh, summarized by
 * scripts/ios-sync-summary.mjs). Same gh-api upsert as scripts/post-perf-comment.mjs, with its own
 * marker so the two comments don't overwrite each other.
 *
 * CI runners are noisy: other VMs on the host slow runs down at random, by up to ~30% within one
 * job. So the comment compares each app's best run (slowdowns only ever add time), headlines the
 * geometric mean of NitromelonDB's speedups over one metric per workload, and flags a metric only
 * when its speedup is clearly below every one of master's recent runs (MASTER_RUNS of them, from
 * the `benchmarks` branch), rather than below a fixed threshold. Medians are shown alongside.
 *
 * Usage:
 *   node scripts/post-ios-sync-comment.mjs <owner/repo> <prNumber> <sha> <summaryFile> <benchmarksJson> <runUrl>
 *
 * summaryFile and benchmarksJson may be missing files (job failed / no master run recorded yet).
 * Requires GH_TOKEN in the environment (gh CLI picks it up automatically).
 */

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  GEOMEAN_METRICS,
  IOS_SYNC_CPU_METRICS,
  IOS_SYNC_METRICS,
  geomeanSpeedup,
  readIosSyncSummary,
  speedup,
} from './ios-sync-summary.mjs'

const MARKER = '<!-- perf-ios-sync-comment -->'
const BODY_FILE = '.perf-ios-sync-comment-body.md'
const MASTER_RUNS = 10
// How far below master's recent range a speedup has to be to get flagged
const FLAG_MARGIN = 0.05

const ALL_METRICS = [...IOS_SYNC_METRICS, ...IOS_SYNC_CPU_METRICS]

/**
 * The summary comes from a run of a PR's code, so keep only what the comment needs, in the shape
 * it expects: finite numbers, and a device and CPU name without markdown or HTML in it.
 */
export function sanitizeSummary(summary) {
  if (!summary || typeof summary !== 'object') return null
  const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  const text = (value) =>
    typeof value === 'string' ? value.replace(/[^\w .,()+-]/g, '').slice(0, 80) : null
  const metrics = (values) =>
    Object.fromEntries(ALL_METRICS.map(({ key }) => [key, number(values?.[key])]))
  return {
    device: text(summary.device),
    runs: {
      sync: number(summary.runs?.sync),
      realistic: number(summary.runs?.realistic),
      stress: number(summary.runs?.stress),
    },
    nitromelondb: metrics(summary.nitromelondb),
    watermelondb: metrics(summary.watermelondb),
    best: {
      nitromelondb: metrics(summary.best?.nitromelondb),
      watermelondb: metrics(summary.best?.watermelondb),
    },
    baseline: summary.baseline
      ? {
          jsMs: number(summary.baseline.jsMs),
          sqliteMs: number(summary.baseline.sqliteMs),
          cpu: text(summary.baseline.cpu),
        }
      : null,
  }
}

function formatValue(value, unit) {
  if (value == null) return '–'
  const rounded =
    unit === 'ms' && value < 100 ? value.toFixed(1) : Math.round(value).toLocaleString('en-US')
  return `${rounded} ${unit}`
}

function formatSpeedup(ratio) {
  if (ratio == null) return '–'
  // Within run-to-run noise
  if (Math.abs(ratio - 1) < 0.03) return 'about the same'
  if (ratio >= 1) return `**${ratio.toFixed(2)}× faster**`
  return `${(1 / ratio).toFixed(2)}× slower`
}

/** A record's best runs if it has them (newer records), otherwise its medians. */
function bestOf(record) {
  const sync = record.iosSync
  return sync.best?.nitromelondb
    ? { nitromelondb: sync.best.nitromelondb, watermelondb: sync.best.watermelondb }
    : { nitromelondb: sync.nitromelondb, watermelondb: sync.watermelondb }
}

export function masterRuns(benchmarksFile) {
  if (!benchmarksFile || !fs.existsSync(benchmarksFile)) return []
  const history = JSON.parse(fs.readFileSync(benchmarksFile, 'utf8'))
  if (!Array.isArray(history)) return []
  return history.filter((record) => record.iosSync?.nitromelondb).slice(-MASTER_RUNS)
}

/** Min and max of a value over master's recent runs, or null. */
function range(values) {
  const known = values.filter((value) => value != null)
  return known.length ? [Math.min(...known), Math.max(...known)] : null
}

function formatRange(r, digits = 2, suffix = '×') {
  if (!r) return '–'
  const [low, high] = r.map((value) => value.toFixed(digits))
  return low === high ? `${low}${suffix}` : `${low}–${high}${suffix}`
}

/** ⚠️ when a speedup is clearly below every recent master run. */
function flag(ratio, masterRange) {
  return ratio != null && masterRange && ratio < masterRange[0] * (1 - FLAG_MARGIN) ? ' ⚠️' : ''
}

function metricRows(metrics, summary, master) {
  return metrics.map((metric) => {
    const n = summary.best.nitromelondb[metric.key]
    const w = summary.best.watermelondb[metric.key]
    const ratio = speedup(metric, n, w)
    const medianRatio = speedup(
      metric,
      summary.nitromelondb[metric.key],
      summary.watermelondb[metric.key],
    )
    const masterRange = range(
      master.map((record) => {
        const best = bestOf(record)
        return speedup(metric, best.nitromelondb?.[metric.key], best.watermelondb?.[metric.key])
      }),
    )
    const median = medianRatio == null ? '' : ` (median ${medianRatio.toFixed(2)}×)`
    return `| ${metric.label} | ${formatValue(n, metric.unit)} | ${formatValue(w, metric.unit)} | ${formatSpeedup(ratio)}${median}${flag(ratio, masterRange)} | ${formatRange(masterRange)} |`
  })
}

export function buildBody({ repo, sha, summary, master = [], runUrl }) {
  const lines = [MARKER, `### iOS sync benchmark (\`${sha.slice(0, 7)}\`)`, '']

  if (!summary) {
    lines.push(`The benchmark didn't produce a result. See the [workflow run](${runUrl}).`)
  } else {
    // Older summaries (before best runs were recorded) only have medians
    if (!summary.best.nitromelondb.sync50kTotalMs) {
      summary.best = { nitromelondb: summary.nitromelondb, watermelondb: summary.watermelondb }
    }
    const overall = geomeanSpeedup(summary.best.nitromelondb, summary.best.watermelondb)
    const overallMedian = geomeanSpeedup(summary.nitromelondb, summary.watermelondb)
    const overallRange = range(
      master.map((record) => {
        const best = bestOf(record)
        return geomeanSpeedup(best.nitromelondb, best.watermelondb)
      }),
    )
    const latest = master[master.length - 1]
    const labels = 'Sync 5k, Sync 50k, Realistic sync and the stress test score'
    lines.push(
      `**Overall: ${overall == null ? '–' : `${overall.toFixed(2)}×`} faster than WatermelonDB 0.28 JSI**${flag(overall, overallRange)}` +
        ` (master's last ${master.length || 'no'} run${master.length === 1 ? '' : 's'}: ${formatRange(overallRange)}; medians: ${overallMedian == null ? '–' : `${overallMedian.toFixed(2)}×`}).` +
        ` Geometric mean of the best-run speedups on ${labels}.`,
      '',
      `Release builds on a GitHub Actions macOS runner (simulator: ${summary.device ?? 'unknown'}), NitromelonDB and WatermelonDB interleaved run by run:` +
        ` ${summary.runs?.sync ?? '?'} runs per app for Sync, ${summary.runs?.realistic ?? '?'} for Realistic sync, ${summary.runs?.stress ?? '?'} for the stress test.` +
        " Other VMs on the runner slow runs down at random, so the table compares each app's **best** run, with the ratio of medians next to it." +
        ` ⚠️ marks a speedup more than ${FLAG_MARGIN * 100}% below every one of master's recent runs (last column).`,
      '',
      "| Metric | NitromelonDB (best) | WatermelonDB JSI (best) | vs WatermelonDB | master's recent runs |",
      '| --- | ---: | ---: | --- | ---: |',
      ...metricRows(IOS_SYNC_METRICS, summary, master),
    )
    if (IOS_SYNC_CPU_METRICS.some((metric) => summary.best.nitromelondb[metric.key] != null)) {
      lines.push(
        '',
        '<details><summary>CPU time per run (app process, all threads; steadier than wall time on CI)</summary>',
        '',
        "| Card | NitromelonDB (best) | WatermelonDB JSI (best) | vs WatermelonDB | master's recent runs |",
        '| --- | ---: | ---: | --- | ---: |',
        ...metricRows(IOS_SYNC_CPU_METRICS, summary, master),
        '',
        '</details>',
      )
    }
    if (summary.baseline?.jsMs != null) {
      const prev = latest?.iosSync?.baseline
      const vs =
        prev?.jsMs != null
          ? ` (master's latest run: ${prev.jsMs.toFixed(0)} / ${prev.sqliteMs?.toFixed(0) ?? '–'} ms)`
          : ''
      lines.push(
        '',
        `Runner baseline (\`scripts/runner-baseline.mjs\`, lower is a faster machine): JS ${summary.baseline.jsMs.toFixed(0)} ms, SQLite ${summary.baseline.sqliteMs?.toFixed(0) ?? '–'} ms${vs}.`,
      )
    }
    lines.push(
      '',
      `[Workflow run](${runUrl}) (raw runs are in its \`perf-result-ios-sync\` artifact).`,
    )
  }

  lines.push(
    '',
    '_Comment `/perf ios` to run it again (maintainers). Also runs on every merge to master. Not a required check._',
  )
  return lines.join('\n')
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' })
}

function main() {
  const [repo, prNumber, sha, summaryFile, benchmarksFile, runUrl] = process.argv.slice(2)
  if (!repo || !prNumber || !sha) {
    console.error(
      'Usage: node scripts/post-ios-sync-comment.mjs <owner/repo> <prNumber> <sha> <summaryFile> <benchmarksJson> <runUrl>',
    )
    process.exit(1)
  }

  const body = buildBody({
    repo,
    sha,
    summary: sanitizeSummary(readIosSyncSummary(summaryFile)),
    master: masterRuns(benchmarksFile),
    runUrl,
  })

  const existing = JSON.parse(
    gh(['api', `repos/${repo}/issues/${prNumber}/comments`, '--paginate']),
  )
  const existingComment = existing.find((comment) => comment.body?.includes(MARKER))

  fs.writeFileSync(BODY_FILE, body)

  try {
    if (existingComment) {
      gh([
        'api',
        '-X',
        'PATCH',
        `repos/${repo}/issues/comments/${existingComment.id}`,
        '-F',
        `body=@${BODY_FILE}`,
      ])
      console.log(`Updated existing iOS sync benchmark comment ${existingComment.id}`)
    } else {
      gh(['api', `repos/${repo}/issues/${prNumber}/comments`, '-F', `body=@${BODY_FILE}`])
      console.log('Created new iOS sync benchmark comment')
    }
  } finally {
    fs.rmSync(BODY_FILE)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
