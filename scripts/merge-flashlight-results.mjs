#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Merges single-iteration flashlight results (`flashlight test --iterationCount 1`, run in turns
 * with the reference app by scripts/ci-notesapp-android-flashlight.sh) into one result with all
 * their iterations, the shape scripts/perf-summary.mjs reads. A reference result also gets
 * `reference`: the tag it was built from. Missing or broken parts (a failed iteration) are skipped,
 * and nothing is written if no iteration is left.
 *
 * Usage: node scripts/merge-flashlight-results.mjs <out.json> <referenceTag or ""> <part.json>...
 */

import fs from 'node:fs'

const [out, reference, ...parts] = process.argv.slice(2)
const iterations = []
for (const part of parts) {
  try {
    const result = JSON.parse(fs.readFileSync(part, 'utf8'))
    iterations.push(...(Array.isArray(result.iterations) ? result.iterations : []))
  } catch {
    console.log(`Skipping ${part}: no result`)
  }
}

if (iterations.length === 0) {
  console.log(`No iterations for ${out}`)
} else {
  const merged = { name: 'Results', status: 'SUCCESS', iterations }
  if (reference) merged.reference = reference
  fs.writeFileSync(out, JSON.stringify(merged))
  console.log(`Wrote ${out}: ${iterations.length} iterations`)
}
