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
 * and their range, so a PR's number can be read against master's run-to-run noise. A single run
 * swings with the CI machine (CPU 23.5% to 33.8% over ten runs of nearly the same code), so CPU,
 * FPS and score are adjusted for each job's machine speed, measured by a fixed reference build in
 * the same job (scripts/android-machine-factor.mjs), once master has MIN_REFERENCE_RUNS runs with it.
 *
 * Usage:
 *   node scripts/post-perf-comment.mjs <owner/repo> <prNumber> [androidResultFile] [benchmarksJson]
 *
 * The reference's result is read from next to the Android one (<name>-reference.json). Any file
 * may be missing (job failed / no reference / no master run recorded yet).
 * Requires GH_TOKEN in the environment (gh CLI picks it up automatically).
 */

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { summarizePerfResult } from './perf-summary.mjs'
import { adjust, machineFactors, median, referenceMedians } from './android-machine-factor.mjs'

const MARKER = '<!-- perf-benchmark-comment -->'
const BODY_FILE = '.perf-comment-body.md'
// Same window as the iOS sync benchmark comment (scripts/post-ios-sync-comment.mjs)
const MASTER_RUNS = 10
// 🔴 only when a value is worse than every recent master run by more than this share of their
// range: with 10 runs, a PR run of unchanged code lands outside the range about 1 time in 11 per
// side and metric, and a comment shouldn't cry wolf that often
const FLAG_MARGIN = 0.5
// Fewer master runs with the reference build than this, and its median isn't a usual value yet
const MIN_REFERENCE_RUNS = 3

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
    reference:
      typeof summary.reference === 'string'
        ? summary.reference.replace(/[^\w.+-]/g, '').slice(0, 40)
        : null,
    iterationCount: finite(summary.iterationCount),
    ...Object.fromEntries(ANDROID_METRICS.map(({ key }) => [key, finite(summary[key])])),
  }
}

/** The `benchmarks` branch history: one record per master commit, oldest first. */
export function readHistory(benchmarksFile) {
  if (!benchmarksFile || !fs.existsSync(benchmarksFile)) return []
  try {
    const history = JSON.parse(fs.readFileSync(benchmarksFile, 'utf8'))
    return Array.isArray(history) ? history : []
  } catch {
    return []
  }
}

/**
 * The PR's values and master's last MASTER_RUNS, adjusted for machine speed when the PR's job
 * measured the reference and master has enough runs with the same one, as measured otherwise.
 */
export function compare(summary, reference, history) {
  const masterRuns = history.filter((record) => finite(record?.android?.cpu) != null)
  const tag = reference?.reference
  const { medians, runs } = tag ? referenceMedians(masterRuns, tag) : { medians: null, runs: 0 }
  const factors = runs >= MIN_REFERENCE_RUNS ? machineFactors(reference, medians) : null
  if (!factors) {
    return {
      values: summary,
      master: masterRuns.slice(-MASTER_RUNS).map((record) => ({ sha: record.sha, values: record.android })),
      adjustment: { tag, runs, factors: null },
    }
  }
  const master = masterRuns
    .map((record) => {
      const recordFactors =
        record.androidReference?.reference === tag
          ? machineFactors(record.androidReference, medians)
          : null
      return recordFactors ? { sha: record.sha, values: adjust(record.android, recordFactors) } : null
    })
    .filter(Boolean)
    .slice(-MASTER_RUNS)
  return { values: adjust(summary, factors), master, adjustment: { tag, runs, factors } }
}

function format(value, metric) {
  return value == null ? '–' : `${value.toFixed(metric.digits)}${metric.unit}`
}

/**
 * The change from master's median, led by a verdict and the direction it moved:
 * 🟢 better than every recent master run, 🟡 within their range (or only slightly worse),
 * 🔴 worse than every one by more than FLAG_MARGIN of their range. ⬆️ / ⬇️ is the value itself,
 * so a lower CPU reads 🟢 ⬇️.
 */
function formatChange(value, masterValues, metric) {
  if (value == null || masterValues.length === 0) return '–'
  // From the rounded median, so the cell matches the two columns next to it
  const change = value - Number(median(masterValues).toFixed(metric.digits))
  const rounded = Math.abs(change).toFixed(metric.digits)
  if (Number(rounded) === 0) return '🟡 ➖ same'
  const text = `${change > 0 ? '⬆️ +' : '⬇️ −'}${rounded}`

  const low = Math.min(...masterValues)
  const high = Math.max(...masterValues)
  if (value >= low && value <= high) return `🟡 ${text} (within range)`
  const better = metric.better === 'higher' ? value > high : value < low
  if (better) return `🟢 ${text} (better)`
  const margin = (high - low) * FLAG_MARGIN
  const clearlyWorse = metric.better === 'higher' ? value < low - margin : value > high + margin
  return clearlyWorse ? `🔴 ${text} (worse)` : `🟡 ${text} (slightly worse)`
}

function formatRange(values, metric) {
  if (values.length === 0) return '–'
  const low = Math.min(...values).toFixed(metric.digits)
  const high = Math.max(...values).toFixed(metric.digits)
  return low === high ? low : `${low}–${high}`
}

function adjustmentNote(summary, { tag, runs, factors }) {
  if (!tag) return null
  if (!factors) {
    return `Not adjusted for machine speed yet: master needs ${MIN_REFERENCE_RUNS} runs with the reference build (NotesApp ${tag}) for its usual values, and has ${runs}.`
  }
  const times = (value) => `${value.toFixed(2)}×`
  return (
    `CPU, FPS and score are adjusted for this CI machine's speed: NotesApp ${tag}, a fixed build measured alternately in the same job, ` +
    `used ${times(factors.cpu)} its usual CPU and got ${times(1 / factors.fps)} its usual FPS and ${times(1 / factors.score)} its usual score (usual: the median over master's ${runs} runs with it). ` +
    `RAM doesn't depend on machine speed and isn't adjusted. As measured: score ${summary.score ?? '–'}, CPU ${summary.cpu ?? '–'}%, FPS ${summary.fps ?? '–'}.`
  )
}

export function buildBody({ repo, summary, reference = null, history = [] }) {
  const lines = [
    MARKER,
    '### Performance benchmark (Android, `maestro/pagination-dynamic.yaml` via [flashlight](https://flashlight.dev))',
    '',
  ]

  if (!summary) {
    lines.push('No data (job did not produce a result).')
  } else {
    const { values, master, adjustment } = compare(summary, reference, history)
    const note = adjustmentNote(summary, adjustment)
    if (master.length === 0) {
      lines.push(
        `Averaged over ${summary.iterationCount ?? '?'} iterations. No master run recorded yet to compare with.`,
        '',
        '| Metric | This PR |',
        '| --- | ---: |',
        ...ANDROID_METRICS.map((metric) => `| ${metric.label} | ${format(values[metric.key], metric)} |`),
      )
    } else {
      const commit = (sha) => `[\`${sha.slice(0, 7)}\`](https://github.com/${repo}/commit/${sha})`
      lines.push(
        `Averaged over ${summary.iterationCount ?? '?'} iterations, against the median of master's last ${master.length} run${master.length === 1 ? '' : 's'} (${commit(master[0].sha)} to ${commit(master[master.length - 1].sha)}).` +
          " 🟢 better than all of them, 🟡 within their range (likely noise), 🔴 clearly worse than all of them. ⬆️ / ⬇️ is which way the value moved.",
        '',
        "| Metric | This PR | master (median) | Change | master's range |",
        '| --- | ---: | ---: | --- | ---: |',
        ...ANDROID_METRICS.map((metric) => {
          const value = finite(values[metric.key])
          const masterValues = master
            .map((record) => finite(record.values[metric.key]))
            .filter((v) => v != null)
          const masterMedian = masterValues.length ? median(masterValues) : null
          return `| ${metric.label} | ${format(value, metric)} | ${format(masterMedian, metric)} | ${formatChange(value, masterValues, metric)} | ${formatRange(masterValues, metric)} |`
        }),
      )
    }
    if (note) lines.push('', note)
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
    reference: androidFile ? readSummary(androidFile.replace(/\.json$/, '-reference.json')) : null,
    history: readHistory(benchmarksFile),
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
