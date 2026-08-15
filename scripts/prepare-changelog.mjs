#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Roll CHANGELOG-Unreleased.md into CHANGELOG.md for a release, or extract notes.
 *
 * Usage:
 *   node scripts/prepare-changelog.mjs roll <version>
 *   node scripts/prepare-changelog.mjs extract <version>
 *   node scripts/prepare-changelog.mjs --self-test
 *
 * Rolling a stable version (no -alpha / -beta) folds every same-core prerelease
 * entry (0.30.0-alpha.0, 0.30.0-alpha.1, 0.30.0-beta.0, …) into one official
 * heading and removes those prerelease sections from CHANGELOG.md.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseVersion } from './next-version.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md')
const DOCS_CHANGELOG_PATH = path.join(ROOT, 'docs-website/docs/docs/CHANGELOG.md')

const UNRELEASED_TEMPLATE = `### Highlights

### BREAKING CHANGES

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal
`

const SECTION_TITLES = [
  'Highlights',
  'BREAKING CHANGES',
  'Deprecations',
  'New features',
  'Fixes',
  'Performance',
  'Changes',
  'Internal',
]

function changelogPaths(root = ROOT) {
  return {
    changelog: path.join(root, 'CHANGELOG.md'),
    unreleased: path.join(root, 'CHANGELOG-Unreleased.md'),
    docs: path.join(root, 'docs-website/docs/docs/CHANGELOG.md'),
  }
}

function stripEmptySections(markdown) {
  const parts = markdown.split(/^(?=### )/m)
  const kept = parts
    .map((section) => section.trim())
    .filter((section) => {
      if (!section) {
        return false
      }
      if (!section.startsWith('### ')) {
        return true
      }
      const body = section.split('\n').slice(1).join('\n').trim()
      return body.length > 0
    })
  return `${kept.join('\n\n')}\n`
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tryParseVersion(version) {
  try {
    return parseVersion(version)
  } catch {
    return null
  }
}

function sameCore(left, right) {
  return left.major === right.major && left.minor === right.minor && left.patch === right.patch
}

export function isSameCorePrerelease(entryVersion, stableVersion) {
  const entry = tryParseVersion(entryVersion)
  const stable = tryParseVersion(stableVersion)
  if (!entry || !stable || stable.hasPrerelease || !entry.hasPrerelease) {
    return false
  }
  return sameCore(entry, stable)
}

function prereleaseOrder(version) {
  const parsed = parseVersion(version)
  const channel = parsed.preid === 'beta' ? 1 : parsed.preid === 'alpha' ? 0 : 2
  return [channel, parsed.prenum ?? 0]
}

function comparePrereleases(left, right) {
  const [leftChannel, leftNum] = prereleaseOrder(left)
  const [rightChannel, rightNum] = prereleaseOrder(right)
  if (leftChannel !== rightChannel) {
    return leftChannel - rightChannel
  }
  return leftNum - rightNum
}

export function splitChangelog(changelog) {
  const firstReleaseHeading = changelog.search(/^## /m)
  if (firstReleaseHeading === -1) {
    throw new Error('CHANGELOG.md has no release headings to insert before')
  }

  const preamble = changelog.slice(0, firstReleaseHeading)
  const blocks = changelog.slice(firstReleaseHeading).split(/^(?=## )/m)
  const entries = blocks.filter(Boolean).map((raw) => {
    const headingMatch = raw.match(/^##[ \t]+(\S+)(?:[ \t]+-[ \t]+(.+))?[ \t]*\n?/)
    if (!headingMatch) {
      return { version: null, date: null, body: raw.trim(), raw }
    }
    return {
      version: headingMatch[1],
      date: headingMatch[2]?.trim() ?? null,
      body: raw.slice(headingMatch[0].length).replace(/^\n+/, '').replace(/\s+$/, ''),
      raw,
    }
  })

  return { preamble, entries }
}

function splitItems(body) {
  const items = []
  for (const line of body.split('\n')) {
    if (/^\s*[-*]\s+/.test(line)) {
      items.push(line.trimEnd())
      continue
    }
    if (items.length === 0) {
      if (line.trim()) {
        items.push(line.trimEnd())
      }
      continue
    }
    if (!line.trim()) {
      continue
    }
    items[items.length - 1] += `\n${line.trimEnd()}`
  }
  return items.map((item) => item.trim()).filter(Boolean)
}

function normalizeItem(item) {
  return item.replace(/\s+/g, ' ').trim()
}

export function parseSections(markdown) {
  const parts = markdown.split(/^(?=### )/m)
  const sections = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed || !trimmed.startsWith('### ')) {
      continue
    }
    const newline = trimmed.indexOf('\n')
    const title = (newline === -1 ? trimmed.slice(4) : trimmed.slice(4, newline)).trim()
    const body = newline === -1 ? '' : trimmed.slice(newline + 1).trim()
    sections.push({ title, items: body ? splitItems(body) : [] })
  }
  return sections
}

export function mergeChangelogBodies(bodies) {
  const itemsBySection = new Map()
  const seenBySection = new Map()
  const extraTitles = []

  const bucketFor = (title) => {
    if (!itemsBySection.has(title)) {
      itemsBySection.set(title, [])
      seenBySection.set(title, new Set())
      if (!SECTION_TITLES.includes(title)) {
        extraTitles.push(title)
      }
    }
    return itemsBySection.get(title)
  }

  for (const body of bodies) {
    for (const { title, items } of parseSections(body)) {
      const bucket = bucketFor(title)
      const seen = seenBySection.get(title)
      for (const item of items) {
        const key = normalizeItem(item)
        if (!key || seen.has(key)) {
          continue
        }
        seen.add(key)
        bucket.push(item)
      }
    }
  }

  const out = []
  for (const title of [...SECTION_TITLES, ...extraTitles]) {
    const items = itemsBySection.get(title)
    if (!items?.length) {
      continue
    }
    out.push(`### ${title}\n\n${items.join('\n')}`)
  }
  return out.join('\n\n')
}

function formatReleaseEntry(version, date, notes) {
  const heading = `## ${version} - ${date}`
  return notes ? `${heading}\n\n${notes}\n` : `${heading}\n`
}

export function foldPrereleaseEntries(changelog, version, unreleasedNotes, date) {
  const parsed = tryParseVersion(version)
  const { preamble, entries } = splitChangelog(changelog)
  const headingRe = new RegExp(`^## ${escapeRegExp(version)}(?: |$)`, 'm')
  if (headingRe.test(changelog)) {
    throw new Error(`CHANGELOG.md already has an entry for ${version}`)
  }

  const shouldFold = parsed && !parsed.hasPrerelease
  const prereleases = shouldFold
    ? entries.filter((entry) => entry.version && isSameCorePrerelease(entry.version, version))
    : []
  prereleases.sort((left, right) => comparePrereleases(left.version, right.version))

  const bodies = [...prereleases.map((entry) => entry.body), unreleasedNotes].filter(
    (body) => body && body.trim(),
  )
  const notes = mergeChangelogBodies(bodies) || stripEmptySections(unreleasedNotes).trim()
  const entry = formatReleaseEntry(version, date, notes)

  const remaining = shouldFold
    ? entries.filter((item) => !(item.version && isSameCorePrerelease(item.version, version)))
    : entries

  const updated = `${preamble}${entry}\n${remaining.map((item) => item.raw).join('')}`
  return {
    changelog: updated.endsWith('\n') ? updated : `${updated}\n`,
    notes,
    folded: prereleases.map((item) => item.version),
    empty: notes.length === 0,
  }
}

export function rollChangelog(version, { date = todayUtc(), root = ROOT } = {}) {
  const paths = changelogPaths(root)
  if (!fs.existsSync(paths.unreleased)) {
    throw new Error('CHANGELOG-Unreleased.md is missing')
  }
  if (!fs.existsSync(paths.changelog)) {
    throw new Error('CHANGELOG.md is missing')
  }

  const unreleased = fs.readFileSync(paths.unreleased, 'utf8')
  const changelog = fs.readFileSync(paths.changelog, 'utf8')
  const unreleasedNotes = stripEmptySections(unreleased).trim()
  const { changelog: updated, notes, folded, empty } = foldPrereleaseEntries(
    changelog,
    version,
    unreleasedNotes,
    date,
  )

  fs.writeFileSync(paths.changelog, updated)
  fs.writeFileSync(paths.unreleased, UNRELEASED_TEMPLATE)
  syncDocsChangelog(updated, paths.docs)

  return { notes, empty, folded }
}

function syncDocsChangelog(changelogContents, docsChangelogPath = DOCS_CHANGELOG_PATH) {
  const docsDir = path.dirname(docsChangelogPath)
  if (!fs.existsSync(docsDir)) {
    return
  }
  const docsChangelog = changelogContents.replaceAll('docs-website/docs/docs/', '').replaceAll('<', '&lt;')
  fs.writeFileSync(docsChangelogPath, docsChangelog)
}

export function extractChangelog(version, changelogContents = fs.readFileSync(CHANGELOG_PATH, 'utf8')) {
  const headingRe = new RegExp(`^## ${escapeRegExp(version)}(?: [-–].*)?$`, 'm')
  const headingMatch = headingRe.exec(changelogContents)
  if (!headingMatch) {
    throw new Error(`No CHANGELOG.md entry found for ${version}`)
  }

  const start = headingMatch.index + headingMatch[0].length
  const rest = changelogContents.slice(start)
  const nextHeading = rest.search(/^## /m)
  const body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim()
  return body
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}\n  actual:\n${actual}\n  expected:\n${expected}`)
  }
}

function assertDeepEqual(actual, expected, label) {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  if (left !== right) {
    throw new Error(`${label}\n  actual:   ${left}\n  expected: ${right}`)
  }
}

function withFixture({ changelog, unreleased }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmdb-changelog-'))
  try {
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog)
    fs.writeFileSync(path.join(dir, 'CHANGELOG-Unreleased.md'), unreleased)
    return fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function runSelfTest() {
  const preamble = `# Changelog\n\nContributors: Please add your changes to CHANGELOG-Unreleased.md\n\n`
  const unreleased = `### New features\n\n- Unreleased feature\n\n### Internal\n\n- Unreleased internal\n`
  const prereleaseChangelog = `${preamble}## 0.30.0-beta.0 - 2026-08-18

### Fixes

- Beta fix

## 0.30.0-alpha.1 - 2026-08-15

### Internal

- Alpha 1 internal
- Shared bullet

## 0.30.0-alpha.0 - 2026-08-15

### BREAKING CHANGES

- Breaking from alpha.0

### New features

- Feature from alpha.0

### Internal

- Alpha 0 internal
- Shared bullet

## 0.28 - 2025-04-07

### Fixes

- Old fix
`

  let failed = 0
  const cases = [
    [
      'merge sections oldest-first and drop duplicate bullets',
      () => {
        const merged = mergeChangelogBodies([
          '### New features\n\n- Feature from alpha.0\n\n### Internal\n\n- Alpha 0 internal\n- Shared bullet\n',
          '### Internal\n\n- Alpha 1 internal\n- Shared bullet\n',
          '### New features\n\n- Unreleased feature\n\n### Internal\n\n- Unreleased internal\n',
        ])
        assertEqual(
          merged,
          [
            '### New features',
            '',
            '- Feature from alpha.0',
            '- Unreleased feature',
            '',
            '### Internal',
            '',
            '- Alpha 0 internal',
            '- Shared bullet',
            '- Alpha 1 internal',
            '- Unreleased internal',
          ].join('\n'),
          'merged bodies',
        )
      },
    ],
    [
      'graduate folds same-core alpha/beta entries and keeps other versions',
      () => {
        const { changelog, folded, notes } = foldPrereleaseEntries(
          prereleaseChangelog,
          '0.30.0',
          stripEmptySections(unreleased).trim(),
          '2026-08-20',
        )
        assertDeepEqual(folded, ['0.30.0-alpha.0', '0.30.0-alpha.1', '0.30.0-beta.0'], 'folded versions')
        if (
          changelog.includes('## 0.30.0-alpha.0') ||
          changelog.includes('## 0.30.0-alpha.1') ||
          changelog.includes('## 0.30.0-beta.0')
        ) {
          throw new Error('prerelease headings should be removed after folding')
        }
        if (!changelog.includes('## 0.28 - 2025-04-07')) {
          throw new Error('older stable entries must stay')
        }
        assertEqual(
          extractChangelog('0.30.0', changelog),
          notes,
          'extract matches folded notes',
        )
        assertEqual(
          notes,
          [
            '### BREAKING CHANGES',
            '',
            '- Breaking from alpha.0',
            '',
            '### New features',
            '',
            '- Feature from alpha.0',
            '- Unreleased feature',
            '',
            '### Fixes',
            '',
            '- Beta fix',
            '',
            '### Internal',
            '',
            '- Alpha 0 internal',
            '- Shared bullet',
            '- Alpha 1 internal',
            '- Unreleased internal',
          ].join('\n'),
          'official notes',
        )
      },
    ],
    [
      'alpha roll does not fold earlier alphas of the same core',
      () => {
        const { changelog, folded } = foldPrereleaseEntries(
          `${preamble}## 0.30.0-alpha.0 - 2026-08-15\n\n### Fixes\n\n- Alpha 0 fix\n`,
          '0.30.0-alpha.1',
          '### Internal\n\n- Alpha 1 internal\n',
          '2026-08-16',
        )
        assertDeepEqual(folded, [], 'no fold on prerelease')
        if (!changelog.includes('## 0.30.0-alpha.0 - 2026-08-15')) {
          throw new Error('previous alpha entry should remain')
        }
        assertEqual(
          extractChangelog('0.30.0-alpha.1', changelog),
          '### Internal\n\n- Alpha 1 internal',
          'alpha.1 notes',
        )
      },
    ],
    [
      'stable roll of a different core does not fold 0.30.0 prereleases',
      () => {
        const { changelog, folded } = foldPrereleaseEntries(
          prereleaseChangelog,
          '1.0.0',
          '### New features\n\n- Major feature\n',
          '2026-09-01',
        )
        assertDeepEqual(folded, [], 'no fold across cores')
        if (!changelog.includes('## 0.30.0-alpha.0 - 2026-08-15')) {
          throw new Error('0.30.0 prereleases must remain when shipping 1.0.0')
        }
        assertEqual(
          extractChangelog('1.0.0', changelog),
          '### New features\n\n- Major feature',
          '1.0.0 notes',
        )
      },
    ],
    [
      'roll writes files, resets unreleased, and folds on graduate',
      () => {
        withFixture({ changelog: prereleaseChangelog, unreleased }, (dir) => {
          const result = rollChangelog('0.30.0', { date: '2026-08-20', root: dir })
          assertDeepEqual(result.folded, ['0.30.0-alpha.0', '0.30.0-alpha.1', '0.30.0-beta.0'], 'roll folded')
          const written = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8')
          const reset = fs.readFileSync(path.join(dir, 'CHANGELOG-Unreleased.md'), 'utf8')
          if (!written.startsWith('## 0.30.0 - 2026-08-20', written.indexOf('## '))) {
            throw new Error('rolled changelog should start with the stable heading')
          }
          assertEqual(reset, UNRELEASED_TEMPLATE, 'unreleased reset')
        })
      },
    ],
    [
      'duplicate stable heading throws',
      () => {
        try {
          foldPrereleaseEntries(
            `${preamble}## 0.30.0 - 2026-08-20\n\n### Fixes\n\n- Already shipped\n`,
            '0.30.0',
            '### Fixes\n\n- New fix\n',
            '2026-08-21',
          )
          throw new Error('expected throw')
        } catch (error) {
          if (!String(error.message).includes('already has an entry')) {
            throw error
          }
        }
      },
    ],
  ]

  for (const [label, fn] of cases) {
    try {
      fn()
      console.log(`ok    ${label}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL  ${label}`)
      console.error(`      ${error.message.replace(/\n/g, '\n      ')}`)
    }
  }

  if (failed) {
    console.error(`\n${failed} test(s) failed`)
    process.exit(1)
  }
  console.log(`\n${cases.length} tests passed`)
}

function main(argv) {
  if (argv[0] === '--self-test') {
    runSelfTest()
    return
  }

  const [command, version] = argv
  if (!command || !version || !['roll', 'extract'].includes(command)) {
    console.error('Usage: node scripts/prepare-changelog.mjs <roll|extract> <version>')
    process.exit(1)
  }

  if (command === 'roll') {
    const { notes, empty, folded } = rollChangelog(version)
    if (folded.length) {
      console.log(`Folded ${folded.join(', ')} into ${version}`)
    }
    if (empty) {
      console.log(`Rolled empty unreleased notes into ${version}`)
    } else {
      console.log(`Rolled unreleased notes into ${version} (${notes.split('\n').length} lines)`)
    }
    return
  }

  console.log(extractChangelog(version))
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main(process.argv.slice(2))
}
