#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Fill in `subject` and `prNumber` on benchmark records that predate
 * publish-perf-results.mjs recording them, so the docs Performance page can
 * show what each run measured and link to its PR. Rewrites the file in place;
 * run by scripts/update-docusaurus on the copy synced into docs-website, never
 * on the `benchmarks` branch itself. Needs full history (docs.yml checks out
 * with fetch-depth: 0); records whose commit isn't available are left as-is.
 *
 * Usage:
 *   node scripts/enrich-benchmarks.mjs <benchmarksJsonFile>
 */

import fs from 'node:fs'
import { commitInfo } from './perf-commit-info.mjs'

function main() {
  const [file] = process.argv.slice(2)
  if (!file) {
    console.error('Usage: node scripts/enrich-benchmarks.mjs <benchmarksJsonFile>')
    process.exit(1)
  }

  const history = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Array.isArray(history)) return

  let enriched = 0
  for (const record of history) {
    if (record.subject && record.prNumber != null) continue
    const info = commitInfo(record.sha)
    if (!info) continue
    record.subject ??= info.subject
    record.prNumber ??= info.prNumber
    enriched++
  }

  fs.writeFileSync(file, JSON.stringify(history, null, 2) + '\n')
  console.log(`Enriched ${enriched} of ${history.length} benchmark records in ${file}`)
}

main()
