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
 * prNumber may be the empty string when the push wasn't associated with a PR.
 */

import fs from 'node:fs'
import path from 'node:path'
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

  const record = {
    sha,
    date: new Date().toISOString(),
    prNumber: prNumber ? Number(prNumber) : null,
    android: summarizePerfResult(androidFile),
  }

  history.push(record)

  fs.mkdirSync(path.dirname(resultsFile) || '.', { recursive: true })
  fs.writeFileSync(resultsFile, JSON.stringify(history, null, 2) + '\n')
  console.log(`Appended record for ${sha} to ${resultsFile} (${history.length} total records)`)
}

main()
