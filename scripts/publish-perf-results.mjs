#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Record one commit's benchmark results in the JSON history file tracked on the
 * `benchmarks` branch. Pure file manipulation only -- scripts/ci-publish-benchmark.sh
 * owns checking out that branch and committing/pushing the result.
 *
 * Usage:
 *   node scripts/publish-perf-results.mjs <resultsFile> <sha> <prNumber> <androidResultFile> [iosSyncSummaryFile]
 *
 * prNumber may be the empty string; it's then taken from the commit subject's
 * "(#123)" suffix when there is one. Either result file may be the empty string:
 * the Android flashlight run (ci.yml) and the iOS sync benchmark (perf-ios.yml)
 * publish separately, so each fills in its own key on the commit's record,
 * creating the record if the other hasn't yet.
 */

import fs from 'node:fs'
import path from 'node:path'
import { commitInfo } from './perf-commit-info.mjs'
import { summarizePerfResult } from './perf-summary.mjs'
import { readIosSyncSummary } from './ios-sync-summary.mjs'

function main() {
  const [resultsFile, sha, prNumber, androidFile, iosSyncFile] = process.argv.slice(2)
  if (!resultsFile || !sha) {
    console.error(
      'Usage: node scripts/publish-perf-results.mjs <resultsFile> <sha> <prNumber> <androidResultFile> [iosSyncSummaryFile]'
    )
    process.exit(1)
  }

  const history = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : []

  // A push to master carries no PR context, so fall back to the "(#123)" GitHub's
  // squash merge appends to the subject (needs the commit locally: fetch-depth: 0).
  const info = commitInfo(sha)
  let record = history.find((existing) => existing.sha === sha)
  if (!record) {
    record = {
      sha,
      date: new Date().toISOString(),
      prNumber: prNumber ? Number(prNumber) : (info?.prNumber ?? null),
      subject: info?.subject ?? null,
    }
    history.push(record)
  }
  if (androidFile) record.android = summarizePerfResult(androidFile)
  if (iosSyncFile) record.iosSync = readIosSyncSummary(iosSyncFile)

  fs.mkdirSync(path.dirname(resultsFile) || '.', { recursive: true })
  fs.writeFileSync(resultsFile, JSON.stringify(history, null, 2) + '\n')
  console.log(`Recorded results for ${sha} in ${resultsFile} (${history.length} total records)`)
}

main()
