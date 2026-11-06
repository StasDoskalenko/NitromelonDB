#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Append one benchmark record to the JSON history file tracked on the
 * `benchmarks` branch. Pure file manipulation only -- the calling workflow
 * (.github/workflows/ci.yml, job perf-publish) owns checking out that
 * branch and committing/pushing the result, mirroring the git-identity /
 * commit / push steps already used in prepare-release.yml.
 *
 * Usage:
 *   node scripts/publish-perf-results.mjs <resultsFile> <sha> <prNumber> <androidResultFile>
 *
 * prNumber may be the empty string; it's then taken from the commit subject's
 * "(#123)" suffix when there is one.
 */

import fs from 'node:fs'
import path from 'node:path'
import { commitInfo } from './perf-commit-info.mjs'
import { summarizePerfResult } from './perf-summary.mjs'

function main() {
  const [resultsFile, sha, prNumber, androidFile] = process.argv.slice(2)
  if (!resultsFile || !sha) {
    console.error(
      'Usage: node scripts/publish-perf-results.mjs <resultsFile> <sha> <prNumber> <androidResultFile>'
    )
    process.exit(1)
  }

  const history = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : []

  // A push to master carries no PR context, so fall back to the "(#123)" GitHub's
  // squash merge appends to the subject (needs the commit locally: fetch-depth: 0).
  const info = commitInfo(sha)
  const record = {
    sha,
    date: new Date().toISOString(),
    prNumber: prNumber ? Number(prNumber) : (info?.prNumber ?? null),
    subject: info?.subject ?? null,
    android: summarizePerfResult(androidFile),
  }

  history.push(record)

  fs.mkdirSync(path.dirname(resultsFile) || '.', { recursive: true })
  fs.writeFileSync(resultsFile, JSON.stringify(history, null, 2) + '\n')
  console.log(`Appended record for ${sha} to ${resultsFile} (${history.length} total records)`)
}

main()
