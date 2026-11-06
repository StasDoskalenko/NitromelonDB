/**
 * Commit metadata for perf benchmark records: the commit subject, and the PR
 * number GitHub's squash merge appends to it ("fix: thing (#173)").
 *
 * Shared by publish-perf-results.mjs (new records, at CI time) and
 * enrich-benchmarks.mjs (backfills older records at docs build time).
 */

import { execFileSync } from 'node:child_process'

const PR_SUFFIX = /\(#(\d+)\)\s*$/

/** The PR number from a squash-merge subject, or null. */
export function prNumberFromSubject(subject) {
  const match = typeof subject === 'string' ? subject.match(PR_SUFFIX) : null
  return match ? Number(match[1]) : null
}

/**
 * { subject, prNumber } for `sha`, or null when the commit isn't in the local
 * clone (shallow checkout, rewritten history) -- callers keep what they have.
 */
export function commitInfo(sha) {
  if (!sha) return null
  try {
    const subject = execFileSync('git', ['log', '-1', '--format=%s', sha], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return subject ? { subject, prNumber: prNumberFromSubject(subject) } : null
  } catch {
    return null
  }
}
