#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Upsert a single PR comment with the perf benchmark summary (score, avg
 * CPU%, RAM, FPS from flashlight -- see scripts/perf-summary.mjs). Uses
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

  lines.push('', '_Updated automatically on each push to this PR. Not a required check._')
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

  const body = buildBody(summarizePerfResult(androidFile))

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
