#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Extract the PerfHUD JSON summary that maestro/perf-run.yaml prints via a
 * console.log sentinel (see examples/NotesApp/src/components/PerfHUD.tsx).
 *
 * That console.log does NOT appear in plain `maestro test` stdout -- it
 * only lands in the structured log written by --debug-output combined with
 * --flatten-debug-output (validated locally against a live simulator run
 * before this pipeline was built). The caller must invoke maestro like:
 *
 *   maestro test --debug-output <dir> --flatten-debug-output maestro/perf-run.yaml
 *
 * which produces <dir>/perf-run/logs/maestro.log.
 *
 * Usage:
 *   node scripts/extract-perf-result.mjs <debugOutputDir> <flowName> <platform> <outFile>
 */

import fs from 'node:fs'
import path from 'node:path'

const SENTINEL_RE = /===PERF_JSON_START===(\{.*?\})===PERF_JSON_END===/gs

function main() {
  const [debugOutputDir, flowName, platform, outFile] = process.argv.slice(2)
  if (!debugOutputDir || !flowName || !platform || !outFile) {
    console.error(
      'Usage: node scripts/extract-perf-result.mjs <debugOutputDir> <flowName> <platform> <outFile>'
    )
    process.exit(1)
  }

  const logPath = path.join(debugOutputDir, flowName, 'logs', 'maestro.log')
  const log = fs.readFileSync(logPath, 'utf8')

  const matches = [...log.matchAll(SENTINEL_RE)]
  if (matches.length === 0) {
    throw new Error(`No PERF_JSON sentinel found in ${logPath}`)
  }
  // The command echo ("Run ${...}") prints the unexecuted script source
  // earlier in the log, which also contains the sentinel strings literally --
  // the *last* match is always the actual console.log output.
  const jsonText = matches[matches.length - 1][1]
  const summary = JSON.parse(jsonText)

  const result = {
    platform,
    recordedAt: new Date().toISOString(),
    summary,
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n')
  console.log(`Wrote ${outFile}`)
}

main()
