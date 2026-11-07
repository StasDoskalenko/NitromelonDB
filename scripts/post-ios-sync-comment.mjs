#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Upsert one PR comment with the iOS sync benchmark (scripts/ci-benchmark-ios.sh, summarized by
 * scripts/ios-sync-summary.mjs). Same gh-api upsert as scripts/post-perf-comment.mjs, with its own
 * marker so the two comments don't overwrite each other.
 *
 * CI machines differ from run to run, so the headline is NitromelonDB vs WatermelonDB JSI measured
 * in the same job. "vs master" compares that ratio with the one in the latest master run on the
 * `benchmarks` branch (absolute times from two different machines wouldn't mean much), and flags
 * a drop of more than REGRESSION_THRESHOLD.
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
import { IOS_SYNC_METRICS, readIosSyncSummary, speedup } from './ios-sync-summary.mjs'

const MARKER = '<!-- perf-ios-sync-comment -->'
const BODY_FILE = '.perf-ios-sync-comment-body.md'
const REGRESSION_THRESHOLD = 0.1

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
  return `${(1 / ratio).toFixed(2)}× slower ⚠️`
}

function formatVsMaster(ratio, masterRatio) {
  if (ratio == null || masterRatio == null) return '–'
  const change = ratio / masterRatio - 1
  const text = `${change >= 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(0)}%`
  return change < -REGRESSION_THRESHOLD ? `${text} ⚠️` : text
}

function latestMasterRun(benchmarksFile) {
  if (!benchmarksFile || !fs.existsSync(benchmarksFile)) return null
  const history = JSON.parse(fs.readFileSync(benchmarksFile, 'utf8'))
  if (!Array.isArray(history)) return null
  return [...history].reverse().find((record) => record.iosSync?.nitromelondb) ?? null
}

export function buildBody({ repo, sha, summary, master, runUrl }) {
  const lines = [MARKER, `### iOS sync benchmark (\`${sha.slice(0, 7)}\`)`, '']

  if (!summary) {
    lines.push(`The benchmark didn't produce a result. See the [workflow run](${runUrl}).`)
  } else {
    const masterNote = master
      ? `master's latest run ([\`${master.sha.slice(0, 7)}\`](https://github.com/${repo}/commit/${master.sha}))`
      : 'master (no run recorded yet)'
    lines.push(
      `Release builds on a GitHub Actions macOS runner (simulator: ${summary.device ?? 'unknown'}), NitromelonDB and WatermelonDB 0.28 JSI interleaved run by run. ` +
        `Medians of ${summary.runs?.sync ?? '?'} runs per app (Sync), ${summary.runs?.realistic ?? '?'} (Realistic sync) and ${summary.runs?.stress ?? '?'} (Stress test).`,
      '',
      `CI machines vary from run to run, so compare the **vs WatermelonDB** column; **vs master** is how that ratio changed from ${masterNote}.`,
      '',
      '| Metric | NitromelonDB | WatermelonDB JSI | vs WatermelonDB | vs master |',
      '| --- | ---: | ---: | --- | ---: |',
    )
    for (const metric of IOS_SYNC_METRICS) {
      const n = summary.nitromelondb?.[metric.key]
      const w = summary.watermelondb?.[metric.key]
      const ratio = speedup(metric, n, w)
      const masterRatio = master
        ? speedup(
            metric,
            master.iosSync.nitromelondb?.[metric.key],
            master.iosSync.watermelondb?.[metric.key],
          )
        : null
      lines.push(
        `| ${metric.label} | ${formatValue(n, metric.unit)} | ${formatValue(w, metric.unit)} | ${formatSpeedup(ratio)} | ${formatVsMaster(ratio, masterRatio)} |`,
      )
    }
    lines.push(
      '',
      `[Workflow run](${runUrl}) (raw runs are in its \`perf-result-ios-sync\` artifact).`,
    )
  }

  lines.push(
    '',
    '_Comment `/perf ios` on a PR to run it again (maintainers). Also runs on every merge to master. Not a required check._',
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
    summary: readIosSyncSummary(summaryFile),
    master: latestMasterRun(benchmarksFile),
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
