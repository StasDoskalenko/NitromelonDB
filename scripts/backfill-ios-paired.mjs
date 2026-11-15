#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Fills in `iosSync.paired` and `iosSync.geomean.paired` (scripts/ios-sync-summary.mjs) on history
 * records from before the summary stored them, from the raw runs in each record's workflow run
 * artifact (`perf-result-ios-sync`, kept 90 days). Adds only those two fields. A record is skipped
 * when its run or artifact can't be found, or when the artifact's medians don't match the record's
 * (so it can't attach runs from a different job). Rewrites the file in place; pushing it to the
 * `benchmarks` branch is up to the caller.
 *
 * Usage (needs gh, authenticated for the repository):
 *   node scripts/backfill-ios-paired.mjs <benchmarksJsonFile> <owner/repo> [workDir]
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { checkEngines, summarizeIosSync } from './ios-sync-summary.mjs'

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' })

/** The successful master push run of perf-ios.yml for a commit, or null. */
function findRun(repo, sha) {
  const out = gh([
    'api',
    `repos/${repo}/actions/workflows/perf-ios.yml/runs?head_sha=${sha}&status=success&per_page=10`,
    '-q',
    '[.workflow_runs[] | select(.event == "push" or .event == "workflow_dispatch")][0].id // empty',
  ]).trim()
  return out || null
}

/** True when the artifact's medians are the record's (same job). */
function sameJob(record, summary) {
  const keys = ['sync50kTotalMs', 'realisticLibraryMs', 'stressScore']
  return ['nitromelondb', 'watermelondb'].every((library) =>
    keys.every((key) => record.iosSync[library]?.[key] === summary[library][key]),
  )
}

function main() {
  const [file, repo, workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-paired-'))] =
    process.argv.slice(2)
  if (!file || !repo) {
    console.error(
      'Usage: node scripts/backfill-ios-paired.mjs <benchmarksJsonFile> <owner/repo> [workDir]',
    )
    process.exit(1)
  }
  const history = JSON.parse(fs.readFileSync(file, 'utf8'))
  let filled = 0
  for (const record of history) {
    if (!record.iosSync || record.iosSync.paired) continue
    const label = `${record.sha.slice(0, 7)} ${record.subject ?? ''}`.trim()
    const runId = findRun(repo, record.sha)
    if (!runId) {
      console.log(`skip ${label}: no successful run`)
      continue
    }
    const dir = path.join(workDir, runId)
    if (!fs.existsSync(path.join(dir, 'ios'))) {
      try {
        gh(['run', 'download', runId, '-R', repo, '-n', 'perf-result-ios-sync', '-D', dir])
      } catch {
        console.log(`skip ${label}: run ${runId} has no artifact (expired?)`)
        continue
      }
    }
    const runs = path.join(dir, 'ios')
    checkEngines(runs)
    const summary = summarizeIosSync(runs)
    if (!sameJob(record, summary)) {
      console.log(`skip ${label}: run ${runId}'s medians don't match the record`)
      continue
    }
    record.iosSync.paired = summary.paired
    record.iosSync.geomean = { ...record.iosSync.geomean, paired: summary.geomean.paired }
    filled++
    console.log(
      `filled ${label}: overall ${summary.geomean.paired}x, stress ${summary.paired.stressScore}x (run ${runId})`,
    )
  }
  fs.writeFileSync(file, JSON.stringify(history, null, 2) + '\n')
  console.log(`Filled ${filled} records in ${file}`)
}

main()
