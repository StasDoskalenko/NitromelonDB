#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * The CodeQL job matrix for .github/workflows/codeql.yml.
 *
 * Usage (in the workflow, after checking out the PR merge commit with fetch-depth 2):
 *   node scripts/codeql-matrix.mjs <event name>   # prints `matrix=<json>` for $GITHUB_OUTPUT
 *   node scripts/codeql-matrix.mjs --self-test
 *
 * Swift and Java/Kotlin need a full native build (Swift on a macOS runner: 20-30 minutes), so on
 * pull requests they only run when the PR changes code they analyze -- or the CodeQL setup itself.
 * Everything else always runs. Pushes to master, the weekly schedule and manual runs analyze every
 * language, so master's code scanning results stay complete. If the changed files can't be
 * determined, every language runs.
 */

import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Changes to these re-run every language
const CODEQL_SETUP = ['.github/workflows/codeql.yml', '.github/codeql/', 'scripts/codeql-matrix.mjs']

// `paths`: on pull requests, the language only runs if a changed file is one of these, or under one
// ending in `/`. Languages without `paths` always run. Generated code and Pods aren't listed: the
// CodeQL config (.github/codeql/codeql-config.yml) excludes them from analysis.
const LANGUAGES = [
  { language: 'actions', 'build-mode': 'none', runner: 'ubuntu-latest', 'timeout-minutes': 60 },
  { language: 'c-cpp', 'build-mode': 'none', runner: 'ubuntu-latest', 'timeout-minutes': 60 },
  {
    language: 'javascript-typescript',
    'build-mode': 'none',
    runner: 'ubuntu-latest',
    'timeout-minutes': 60,
  },
  { language: 'ruby', 'build-mode': 'none', runner: 'ubuntu-latest', 'timeout-minutes': 60 },
  {
    language: 'java-kotlin',
    'build-mode': 'manual',
    runner: 'ubuntu-24.04',
    'timeout-minutes': 60,
    paths: ['native/android/', 'native/androidTest/', 'android/'],
  },
  {
    language: 'swift',
    'build-mode': 'manual',
    runner: 'macos-26',
    'timeout-minutes': 120,
    // Swift lives in native/iosTest; its build also compiles the library's iOS code
    paths: ['native/iosTest/', 'native/ios/', 'NitromelonDB.podspec', 'Gemfile', 'Gemfile.lock'],
  },
]

const touches = (files, paths) =>
  files.some((file) => paths.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p)))

// `changedFiles`: null when unknown -- then every language runs
export function codeqlMatrix(eventName, changedFiles) {
  const runAll = eventName !== 'pull_request' || !changedFiles || touches(changedFiles, CODEQL_SETUP)
  const include = LANGUAGES.filter(
    ({ paths }) => runAll || !paths || touches(changedFiles, paths),
  ).map(({ paths, ...entry }) => entry)
  return { include }
}

// The PR's changes: the merge commit GitHub checks out for pull_request events, against its first
// parent (the base branch). null if that can't be read.
function changedFilesOfMergeCommit() {
  try {
    const out = execFileSync('git', ['diff', '--name-only', 'HEAD^1', 'HEAD'], { encoding: 'utf8' })
    return out.split('\n').filter(Boolean)
  } catch (error) {
    console.error(`Couldn't list the changed files, so analyzing every language: ${error.message}`)
    return null
  }
}

function selfTest() {
  const languages = (matrix) => matrix.include.map((entry) => entry.language)
  const always = ['actions', 'c-cpp', 'javascript-typescript', 'ruby']
  const all = [...always, 'java-kotlin', 'swift']

  assert.deepEqual(languages(codeqlMatrix('push', ['src/index.ts'])), all)
  assert.deepEqual(languages(codeqlMatrix('schedule', [])), all)
  assert.deepEqual(languages(codeqlMatrix('workflow_dispatch', null)), all)

  assert.deepEqual(languages(codeqlMatrix('pull_request', ['src/sync/impl/fetchLocal.ts'])), always)
  assert.deepEqual(languages(codeqlMatrix('pull_request', ['nitrogen/generated/ios/x.swift'])), always)
  assert.deepEqual(
    languages(codeqlMatrix('pull_request', ['native/iosTest/WatermelonTester/AppDelegate.swift'])),
    [...always, 'swift'],
  )
  assert.deepEqual(languages(codeqlMatrix('pull_request', ['native/ios/NitromelonDB/x.mm'])), [
    ...always,
    'swift',
  ])
  assert.deepEqual(
    languages(codeqlMatrix('pull_request', ['native/android/src/main/java/com/x/Y.java'])),
    [...always, 'java-kotlin'],
  )
  // a prefix match must end at a directory boundary
  assert.deepEqual(languages(codeqlMatrix('pull_request', ['native/androidTestdata.txt'])), always)
  assert.deepEqual(languages(codeqlMatrix('pull_request', ['.github/codeql/codeql-config.yml'])), all)
  assert.deepEqual(languages(codeqlMatrix('pull_request', ['.github/workflows/codeql.yml'])), all)
  assert.deepEqual(languages(codeqlMatrix('pull_request', null)), all)

  // entries carry exactly what the workflow reads, and no `paths`
  for (const entry of codeqlMatrix('push', []).include) {
    assert.deepEqual(Object.keys(entry).sort(), ['build-mode', 'language', 'runner', 'timeout-minutes'])
  }
  console.log('codeql-matrix self-test passed')
}

function main(argv) {
  if (argv[0] === '--self-test') {
    selfTest()
    return
  }
  const eventName = argv[0]
  if (!eventName) {
    console.error('Usage: node scripts/codeql-matrix.mjs <event name> | --self-test')
    process.exit(1)
  }
  const changedFiles = eventName === 'pull_request' ? changedFilesOfMergeCommit() : null
  const matrix = codeqlMatrix(eventName, changedFiles)
  console.error(`Analyzing: ${matrix.include.map((entry) => entry.language).join(', ')}`)
  console.log(`matrix=${JSON.stringify(matrix)}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main(process.argv.slice(2))
}
