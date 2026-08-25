#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Upsert a single PR comment with the perf benchmark summary (avg CPU%,
 * avg memory, avg JS/UI FPS per platform). Uses `gh api` directly (not
 * `gh pr comment`, which always posts a fresh comment -- see
 * publish-release.yml) so the same comment is found and edited in place on
 * every push to the PR, matching this repo's existing gh-CLI-only
 * convention rather than adding an Octokit dependency.
 *
 * Usage:
 *   node scripts/post-perf-comment.mjs <owner/repo> <prNumber> [androidResultFile] [iosResultFile]
 *
 * Requires GH_TOKEN in the environment (gh CLI picks it up automatically).
 */

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const MARKER = '<!-- perf-benchmark-comment -->'
const BODY_FILE = '.perf-comment-body.md'

function readResult(file) {
  if (!file || !fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function formatRow(label, stats) {
  if (!stats) return `| ${label} | – | – | – |`
  return `| ${label} | ${stats.avg} | ${stats.min} | ${stats.max} |`
}

function platformSection(name, result) {
  if (!result) {
    return `**${name}**: no data (job did not produce a result)\n`
  }
  const { summary } = result
  return [
    `**${name}** (${summary.sampleCount} samples over ${(summary.durationMs / 1000).toFixed(1)}s)`,
    '',
    '| Metric | Avg | Min | Max |',
    '| --- | --- | --- | --- |',
    formatRow('CPU %', summary.cpu),
    formatRow('Memory (MB)', summary.memory),
    formatRow('JS FPS', summary.jsFps),
    formatRow('UI FPS', summary.uiFps),
    '',
  ].join('\n')
}

function buildBody(androidResult, iosResult) {
  return [
    MARKER,
    '### Performance benchmark (`maestro/perf-run.yaml`)',
    '',
    platformSection('Android', androidResult),
    platformSection('iOS', iosResult),
    '_Updated automatically on each push to this PR. Not a required check._',
  ].join('\n')
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' })
}

function main() {
  const [repo, prNumber, androidFile, iosFile] = process.argv.slice(2)
  if (!repo || !prNumber) {
    console.error(
      'Usage: node scripts/post-perf-comment.mjs <owner/repo> <prNumber> [androidResultFile] [iosResultFile]'
    )
    process.exit(1)
  }

  const androidResult = readResult(androidFile)
  const iosResult = readResult(iosFile)
  const body = buildBody(androidResult, iosResult)

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
        '-f',
        `body=@${BODY_FILE}`,
      ])
      console.log(`Updated existing perf comment ${existingComment.id}`)
    } else {
      gh(['api', `repos/${repo}/issues/${prNumber}/comments`, '-f', `body=@${BODY_FILE}`])
      console.log('Created new perf comment')
    }
  } finally {
    fs.rmSync(BODY_FILE)
  }
}

main()
