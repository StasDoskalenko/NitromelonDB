#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Upsert a single PR comment with the perf benchmark summary (score, avg
 * CPU%, RAM, FPS from flashlight -- see scripts/perf-summary.mjs). Run by
 * .github/workflows/perf-comments.yml after a PR's CI run, on the result file
 * that run uploaded, so the file is treated as untrusted data. Uses
 * `gh api` directly (not `gh pr comment`, which always posts a fresh
 * comment -- see publish-release.yml) so the same comment is found and
 * edited in place on every push to the PR, matching this repo's existing
 * gh-CLI-only convention rather than adding an Octokit dependency.
 *
 * Each metric is shown next to master's recent runs from the `benchmarks` branch: their median
 * (a single run swings with the CI machine, e.g. CPU 23.5% to 33.8% over ten runs of the same
 * code) and their range, so a PR's number can be read against master's run-to-run noise.
 *
 * Usage:
 *   node scripts/post-perf-comment.mjs <owner/repo> <prNumber> [androidResultFile] [benchmarksJson]
 *
 * Either file may be missing (job failed / no master run recorded yet).
 * Requires GH_TOKEN in the environment (gh CLI picks it up automatically).
 */

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { summarizePerfResult } from './perf-summary.mjs'

const MARKER = '<!-- perf-benchmark-comment -->'
const BODY_FILE = '.perf-comment-body.md'
// Same window as the iOS sync benchmark comment (scripts/post-ios-sync-comment.mjs)
const MASTER_RUNS = 10
// ⚠️ only when a value is worse than every recent master run by more than this share of their
// range: with 10 runs, a PR run of unchanged code lands outside the range about 1 time in 11 per
// side and metric, and a comment shouldn't cry wolf that often
const FLAG_MARGIN = 0.5

export const ANDROID_METRICS = [
  { key: 'score', label: 'Score', unit: '/100', digits: 0, better: 'higher' },
  { key: 'cpu', label: 'CPU %', unit: '', digits: 1, better: 'lower' },
  { key: 'ram', label: 'RAM (MB)', unit: '', digits: 0, better: 'lower' },
  { key: 'fps', label: 'FPS', unit: '', digits: 1, better: 'higher' },
]

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

// The result file comes from a run of the PR's code: a file that isn't a flashlight result
// counts as no data, and only finite numbers go into the comment
function readSummary(file) {
  let summary
  try {
    summary = summarizePerfResult(file)
  } catch {
    return null
  }
  return sanitizeSummary(summary)
}

export function sanitizeSummary(summary) {
  if (!summary || typeof summary !== 'object') return null
  return {
    iterationCount: finite(summary.iterationCount),
    ...Object.fromEntries(ANDROID_METRICS.map(({ key }) => [key, finite(summary[key])])),
  }
}

/** Master's last MASTER_RUNS flashlight results, oldest first. */
export function masterRuns(benchmarksFile) {
  if (!benchmarksFile || !fs.existsSync(benchmarksFile)) return []
  let history
  try {
    history = JSON.parse(fs.readFileSync(benchmarksFile, 'utf8'))
  } catch {
    return []
  }
  if (!Array.isArray(history)) return []
  return history.filter((record) => finite(record?.android?.cpu) != null).slice(-MASTER_RUNS)
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function format(value, metric) {
  return value == null ? '–' : `${value.toFixed(metric.digits)}${metric.unit}`
}

function formatChange(value, masterValues, metric) {
  if (value == null || masterValues.length === 0) return '–'
  // From the rounded median, so the cell matches the two columns next to it
  const change = value - Number(median(masterValues).toFixed(metric.digits))
  const rounded = Math.abs(change).toFixed(metric.digits)
  if (Number(rounded) === 0) return 'same'
  const text = `${change > 0 ? '+' : '−'}${rounded}`

  const low = Math.min(...masterValues)
  const high = Math.max(...masterValues)
  if (value >= low && value <= high) return `${text} (within range)`
  const better = metric.better === 'higher' ? value > high : value < low
  if (better) return `${text} (better)`
  const margin = (high - low) * FLAG_MARGIN
  const clearlyWorse = metric.better === 'higher' ? value < low - margin : value > high + margin
  return clearlyWorse ? `${text} (worse) ⚠️` : `${text} (worse)`
}

function formatRange(values, metric) {
  if (values.length === 0) return '–'
  const low = Math.min(...values).toFixed(metric.digits)
  const high = Math.max(...values).toFixed(metric.digits)
  return low === high ? low : `${low}–${high}`
}

export function buildBody({ repo, summary, master = [] }) {
  const lines = [
    MARKER,
    '### Performance benchmark (Android, `maestro/pagination-dynamic.yaml` via [flashlight](https://flashlight.dev))',
    '',
  ]

  if (!summary) {
    lines.push('No data (job did not produce a result).')
  } else if (master.length === 0) {
    lines.push(
      `Averaged over ${summary.iterationCount ?? '?'} iterations. No master run recorded yet to compare with.`,
      '',
      '| Metric | This PR |',
      '| --- | ---: |',
      ...ANDROID_METRICS.map((metric) => `| ${metric.label} | ${format(summary[metric.key], metric)} |`),
    )
  } else {
    const commit = (sha) => `[\`${sha.slice(0, 7)}\`](https://github.com/${repo}/commit/${sha})`
    lines.push(
      `Averaged over ${summary.iterationCount ?? '?'} iterations, against the median of master's last ${master.length} run${master.length === 1 ? '' : 's'} (${commit(master[0].sha)} to ${commit(master[master.length - 1].sha)}).` +
        " CI machines vary from run to run, so a change within master's range is likely noise. ⚠️ marks a value well outside it, on the worse side.",
      '',
      "| Metric | This PR | master (median) | Change | master's range |",
      '| --- | ---: | ---: | --- | ---: |',
      ...ANDROID_METRICS.map((metric) => {
        const value = summary[metric.key]
        const masterValues = master
          .map((record) => finite(record.android[metric.key]))
          .filter((v) => v != null)
        const masterMedian = masterValues.length ? median(masterValues) : null
        return `| ${metric.label} | ${format(value, metric)} | ${format(masterMedian, metric)} | ${formatChange(value, masterValues, metric)} | ${formatRange(masterValues, metric)} |`
      }),
    )
  }

  lines.push(
    '',
    '_Updated automatically after each CI run of this PR. Not a required check._',
    '',
    '> [!TIP]',
    '> Touching sync, queries or native code? Comment `/perf ios` to request the iOS sync benchmark against WatermelonDB on this PR (see `.github/workflows/perf-ios.yml`). A maintainer\'s request starts it right away (👀 on the comment); anyone else\'s asks a maintainer to start it.'
  )
  return lines.join('\n')
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' })
}

function main() {
  const [repo, prNumber, androidFile, benchmarksFile] = process.argv.slice(2)
  if (!repo || !prNumber) {
    console.error(
      'Usage: node scripts/post-perf-comment.mjs <owner/repo> <prNumber> [androidResultFile] [benchmarksJson]'
    )
    process.exit(1)
  }

  const body = buildBody({
    repo,
    summary: readSummary(androidFile),
    master: masterRuns(benchmarksFile),
  })

  const existing = JSON.parse(gh(['api', `repos/${repo}/issues/${prNumber}/comments`, '--paginate']))
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
      console.log(`Updated existing perf comment ${existingComment.id}`)
    } else {
      gh(['api', `repos/${repo}/issues/${prNumber}/comments`, '-F', `body=@${BODY_FILE}`])
      console.log('Created new perf comment')
    }
  } finally {
    fs.rmSync(BODY_FILE)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
