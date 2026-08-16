#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Compute the next NitromelonDB version from a semver bump + optional prerelease channel.
 *
 * Usage:
 *   node scripts/next-version.mjs <none|promote|patch|minor|major> <none|alpha|beta> [currentVersion]
 *   node scripts/next-version.mjs --self-test
 *
 * Repeat alpha/beta releases of the same in-progress version increment the prerelease
 * counter (1.0.0-alpha.0 → 1.0.0-alpha.1). Switching channel resets it (alpha → beta.0).
 * Choosing bump `none` keeps the current X.Y.Z (next -alpha.N, or graduate if prerelease is none).
 * Choosing bump `promote` (or prerelease `none` on a prerelease) publishes that core version as stable.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BUMPS = new Set(['none', 'promote', 'patch', 'minor', 'major'])
const PREIDS = new Set(['none', 'alpha', 'beta'])

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z]+)(?:\.(\d+))?|-(\d+))?$/

export function parseVersion(version) {
  const match = VERSION_RE.exec(version)
  if (!match) {
    throw new Error(`Invalid version: ${version}`)
  }

  const preid = match[4] ?? null
  const prenum =
    match[5] !== undefined ? Number(match[5]) : match[6] !== undefined ? Number(match[6]) : null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    preid,
    prenum,
    hasPrerelease: version.includes('-'),
  }
}

function formatCore({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`
}

function bumpCore(parsed, bump) {
  switch (bump) {
    case 'none':
      return { major: parsed.major, minor: parsed.minor, patch: parsed.patch }
    case 'major':
      return { major: parsed.major + 1, minor: 0, patch: 0 }
    case 'minor':
      return { major: parsed.major, minor: parsed.minor + 1, patch: 0 }
    case 'patch':
      return { major: parsed.major, minor: parsed.minor, patch: parsed.patch + 1 }
    default:
      throw new Error(`Invalid bump: ${bump}`)
  }
}

/**
 * Stay on the current X.Y.Z when repeating a prerelease of the version that bump
 * originally produced:
 *   1.0.0-alpha.0 + major + alpha → 1.0.0-alpha.1
 *   0.29.0-alpha.0 + minor + alpha → 0.29.0-alpha.1
 *   0.28.2-alpha.0 + patch + alpha → 0.28.2-alpha.1
 *
 * A different bump starts a new core version:
 *   0.29.0-alpha.0 + major + alpha → 1.0.0-alpha.0
 *   1.0.0-alpha.0 + minor + alpha → 1.1.0-alpha.0
 */
function shouldStayOnCurrentCore(parsed, bump) {
  if (bump === 'none') {
    return true
  }
  if (bump === 'major') {
    return parsed.minor === 0 && parsed.patch === 0
  }
  if (bump === 'minor') {
    return parsed.patch === 0 && parsed.minor !== 0
  }
  return parsed.patch !== 0
}

export function nextVersion(current, bump, preid) {
  if (!BUMPS.has(bump)) {
    throw new Error(`Invalid bump: ${bump}`)
  }
  if (!PREIDS.has(preid)) {
    throw new Error(`Invalid prerelease: ${preid}`)
  }

  const parsed = parseVersion(current)
  const currentCore = formatCore(parsed)

  if (bump === 'promote') {
    if (!parsed.hasPrerelease) {
      throw new Error(
        'Version bump "promote" only works on an in-progress alpha/beta. The current version is already stable.',
      )
    }
    return currentCore
  }

  if (bump === 'none' && !parsed.hasPrerelease) {
    throw new Error(
      'Version bump "none" only works on an in-progress alpha/beta. Pick patch, minor, or major to start a new version.',
    )
  }

  let targetCore = currentCore
  if (!parsed.hasPrerelease) {
    targetCore = formatCore(bumpCore(parsed, bump))
  } else if (!shouldStayOnCurrentCore(parsed, bump)) {
    targetCore = formatCore(bumpCore(parsed, bump))
  }

  if (preid === 'none') {
    return targetCore
  }

  const sameLine = currentCore === targetCore && parsed.preid === preid
  if (sameLine) {
    const nextNum = (parsed.prenum ?? -1) + 1
    return `${targetCore}-${preid}.${nextNum < 0 ? 0 : nextNum}`
  }

  return `${targetCore}-${preid}.0`
}

const SELF_TESTS = [
  ['0.28.1', 'major', 'none', '1.0.0'],
  ['0.28.1', 'major', 'alpha', '1.0.0-alpha.0'],
  ['0.28.1', 'minor', 'alpha', '0.29.0-alpha.0'],
  ['0.28.1', 'patch', 'none', '0.28.2'],
  ['0.28.1', 'patch', 'alpha', '0.28.2-alpha.0'],
  ['1.0.0-alpha.0', 'major', 'alpha', '1.0.0-alpha.1'],
  ['1.0.0-alpha.1', 'major', 'alpha', '1.0.0-alpha.2'],
  ['1.0.0-alpha.2', 'major', 'beta', '1.0.0-beta.0'],
  ['1.0.0-beta.0', 'major', 'beta', '1.0.0-beta.1'],
  ['1.0.0-beta.0', 'major', 'none', '1.0.0'],
  ['1.0.0-alpha.2', 'major', 'none', '1.0.0'],
  ['0.29.0-alpha.0', 'minor', 'alpha', '0.29.0-alpha.1'],
  ['0.29.0-alpha.1', 'minor', 'none', '0.29.0'],
  ['0.29.0-alpha.0', 'major', 'alpha', '1.0.0-alpha.0'],
  ['0.28.2-alpha.0', 'patch', 'alpha', '0.28.2-alpha.1'],
  ['0.28.2-alpha.0', 'patch', 'none', '0.28.2'],
  ['0.28.1-0', 'minor', 'alpha', '0.29.0-alpha.0'],
  ['0.28.1-0', 'patch', 'none', '0.28.1'],
  ['0.28.1-0', 'major', 'alpha', '1.0.0-alpha.0'],
  ['0.28.1-0', 'minor', 'none', '0.29.0'],
  ['1.0.0', 'minor', 'beta', '1.1.0-beta.0'],
  ['1.1.0-beta.0', 'minor', 'beta', '1.1.0-beta.1'],
  ['1.0.0-alpha.0', 'minor', 'alpha', '1.1.0-alpha.0'],
  ['1.0.0-alpha.0', 'patch', 'alpha', '1.0.1-alpha.0'],
  ['0.29.0-alpha.0', 'patch', 'alpha', '0.29.1-alpha.0'],
  ['0.30.0-alpha.0', 'none', 'alpha', '0.30.0-alpha.1'],
  ['0.30.0-alpha.1', 'none', 'alpha', '0.30.0-alpha.2'],
  ['0.30.0-alpha.1', 'none', 'beta', '0.30.0-beta.0'],
  ['0.30.0-beta.0', 'none', 'none', '0.30.0'],
  ['0.30.0-alpha.3', 'promote', 'none', '0.30.0'],
  ['0.30.0-alpha.3', 'promote', 'alpha', '0.30.0'],
  ['0.30.0-beta.1', 'promote', 'beta', '0.30.0'],
  ['1.0.0-alpha.0', 'none', 'alpha', '1.0.0-alpha.1'],
  ['1.0.0-alpha.2', 'none', 'none', '1.0.0'],
]

function readCurrentVersion() {
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  return pkg.version
}

function runSelfTest() {
  let failed = 0
  for (const [current, bump, preid, expected] of SELF_TESTS) {
    const actual = nextVersion(current, bump, preid)
    if (actual !== expected) {
      failed += 1
      console.error(`FAIL  ${current} + ${bump} + ${preid} → ${actual} (expected ${expected})`)
    } else {
      console.log(`ok    ${current} + ${bump} + ${preid} → ${actual}`)
    }
  }

  const errorCases = [
    ['0.30.0', 'none', 'alpha'],
    ['0.30.0', 'none', 'none'],
    ['0.30.0', 'promote', 'none'],
  ]
  for (const [current, bump, preid] of errorCases) {
    try {
      const actual = nextVersion(current, bump, preid)
      failed += 1
      console.error(`FAIL  ${current} + ${bump} + ${preid} should throw, got ${actual}`)
    } catch {
      console.log(`ok    ${current} + ${bump} + ${preid} throws`)
    }
  }

  const total = SELF_TESTS.length + errorCases.length
  if (failed) {
    console.error(`\n${failed} test(s) failed`)
    process.exit(1)
  }
  console.log(`\n${total} tests passed`)
}

function main(argv) {
  if (argv[0] === '--self-test') {
    runSelfTest()
    return
  }

  const bump = argv[0]
  const preid = argv[1]
  const current = argv[2] || readCurrentVersion()

  if (!bump || !preid) {
    console.error('Usage: node scripts/next-version.mjs <none|promote|patch|minor|major> <none|alpha|beta> [currentVersion]')
    process.exit(1)
  }

  const version = nextVersion(current, bump, preid)
  console.log(version)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main(process.argv.slice(2))
}
