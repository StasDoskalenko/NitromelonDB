#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Roll CHANGELOG-Unreleased.md into CHANGELOG.md for a release, or extract notes.
 *
 * Usage:
 *   node scripts/prepare-changelog.mjs roll <version>
 *   node scripts/prepare-changelog.mjs extract <version>
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md')
const UNRELEASED_PATH = path.join(ROOT, 'CHANGELOG-Unreleased.md')
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

export function rollChangelog(version, { date = todayUtc() } = {}) {
  if (!fs.existsSync(UNRELEASED_PATH)) {
    throw new Error('CHANGELOG-Unreleased.md is missing')
  }
  if (!fs.existsSync(CHANGELOG_PATH)) {
    throw new Error('CHANGELOG.md is missing')
  }

  const unreleased = fs.readFileSync(UNRELEASED_PATH, 'utf8')
  const notes = stripEmptySections(unreleased).trim()
  const changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8')

  const heading = `## ${version} - ${date}`
  const entry = notes ? `${heading}\n\n${notes}\n` : `${heading}\n`
  const headingRe = new RegExp(`^## ${escapeRegExp(version)}(?: |$)`, 'm')
  if (headingRe.test(changelog)) {
    throw new Error(`CHANGELOG.md already has an entry for ${version}`)
  }

  const firstReleaseHeading = changelog.search(/^## /m)
  if (firstReleaseHeading === -1) {
    throw new Error('CHANGELOG.md has no release headings to insert before')
  }

  const updated = `${changelog.slice(0, firstReleaseHeading)}${entry}\n${changelog.slice(firstReleaseHeading)}`

  fs.writeFileSync(CHANGELOG_PATH, updated)
  fs.writeFileSync(UNRELEASED_PATH, UNRELEASED_TEMPLATE)
  syncDocsChangelog(updated)

  return { notes, empty: notes.length === 0 }
}

function syncDocsChangelog(changelogContents) {
  const docsDir = path.dirname(DOCS_CHANGELOG_PATH)
  if (!fs.existsSync(docsDir)) {
    return
  }
  const docsChangelog = changelogContents.replaceAll('docs-website/docs/docs/', '').replaceAll('<', '&lt;')
  fs.writeFileSync(DOCS_CHANGELOG_PATH, docsChangelog)
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

function main(argv) {
  const [command, version] = argv
  if (!command || !version || !['roll', 'extract'].includes(command)) {
    console.error('Usage: node scripts/prepare-changelog.mjs <roll|extract> <version>')
    process.exit(1)
  }

  if (command === 'roll') {
    const { notes, empty } = rollChangelog(version)
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
