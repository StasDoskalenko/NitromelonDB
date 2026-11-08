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
 * Usage:
 *   node scripts/post-perf-comment.mjs <owner/repo> <prNumber> [androidResultFile]
 *
 * Requires GH_TOKEN in the environment (gh CLI picks it up automatically).
 */

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { summarizePerfResult } from './perf-summary.mjs'

const MARKER = '<!-- perf-benchmark-comment -->'
const BODY_FILE = '.perf-comment-body.md'

// The result file comes from a run of the PR's code: a file that isn't a flashlight result
// counts as no data, and only finite numbers go into the comment
function readSummary(file) {
  let summary
  try {
    summary = summarizePerfResult(file)
  } catch {
    return null
  }
  if (!summary) return null
  const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : '–')
  return {
    iterationCount: number(summary.iterationCount),
    score: number(summary.score),
    cpu: number(summary.cpu),
    ram: number(summary.ram),
    fps: number(summary.fps),
  }
}

function buildBody(androidSummary) {
  const lines = [
    MARKER,
    '### Performance benchmark (Android, `maestro/pagination-dynamic.yaml` via [flashlight](https://flashlight.dev))',
    '',
  ]

  if (!androidSummary) {
    lines.push('No data (job did not produce a result).')
  } else {
    lines.push(
      `Averaged over ${androidSummary.iterationCount} iterations.`,
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Score | ${androidSummary.score}/100 |`,
      `| CPU % | ${androidSummary.cpu} |`,
      `| RAM (MB) | ${androidSummary.ram} |`,
      `| FPS | ${androidSummary.fps} |`
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
  const [repo, prNumber, androidFile] = process.argv.slice(2)
  if (!repo || !prNumber) {
    console.error('Usage: node scripts/post-perf-comment.mjs <owner/repo> <prNumber> [androidResultFile]')
    process.exit(1)
  }

  const body = buildBody(readSummary(androidFile))

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

main()
