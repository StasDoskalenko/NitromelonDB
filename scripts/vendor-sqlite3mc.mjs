#!/usr/bin/env node
/**
 * Vendor the SQLite3 Multiple Ciphers (sqlite3mc) amalgamation into native/vendor/sqlite3mc.
 * sqlite3mc is unmodified SQLite plus an encryption VFS; with no key set it reads and writes
 * ordinary SQLite files. Apps that opt into encryption ("nitromelondb": { "encryption": true }
 * in their package.json) compile it instead of plain SQLite, through
 * native/shared/NitromelonSqlite.c (see NitromelonSqliteConfig.h for the build options).
 *
 * The version argument is the sqlite3mc release, not the SQLite version it is built on. Keep
 * native/vendor/sqlite on that same SQLite version (`yarn test:native-unit` checks it):
 *
 *   node scripts/vendor-sqlite3mc.mjs 2.7.1
 *   node scripts/vendor-sqlite3mc.mjs --latest
 *   node scripts/vendor-sqlite3mc.mjs --latest --if-newer
 *   node scripts/vendor-sqlite.mjs <the SQLite version it is built on>
 *
 * Set GITHUB_TOKEN to avoid the GitHub API's anonymous rate limit.
 */
import { execFileSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const VENDOR = path.join(ROOT, 'native', 'vendor', 'sqlite3mc')
// Not named VERSION: that directory is on the native include path, and a
// case-insensitive volume treats VERSION as C++'s <version> header.
const MC_VERSION_PATH = path.join(VENDOR, 'sqlite3mc.version')
const SQLITE_VERSION_PATH = path.join(VENDOR, 'sqlite.version')
const REPO = 'utelle/SQLite3MultipleCiphers'
const API = `https://api.github.com/repos/${REPO}`
// sqlite3mc_amalgamation.h already contains sqlite3.h and sqlite3ext.h. Not vendoring
// those here means a stray `#include <sqlite3.h>` in the encryption build fails to compile
// instead of silently picking up another copy of SQLite.
const KEEP_FILES = ['sqlite3mc_amalgamation.c', 'sqlite3mc_amalgamation.h']
// Anything else in the vendor directory is left over from a previous layout.
const OWNED_FILES = new Set([...KEEP_FILES, 'COPYRIGHT', 'LICENSE', 'sqlite3mc.version', 'sqlite.version'])

const args = process.argv.slice(2)
const wantLatest = args.includes('--latest')
const ifNewer = args.includes('--if-newer')
const versionArg = args.find((arg) => !arg.startsWith('--'))

function usage() {
  console.error('Usage: node scripts/vendor-sqlite3mc.mjs <sqlite3mc version|--latest> [--if-newer]')
  process.exit(2)
}

if (!wantLatest && !versionArg) {
  usage()
}

function readVersion(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

function compareVersions(a, b) {
  const pa = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0)
  const pb = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] || 0
    const db = pb[i] || 0
    if (da > db) {
      return 1
    }
    if (da < db) {
      return -1
    }
  }
  return 0
}

function writeGithubOutput(fields) {
  if (!process.env.GITHUB_OUTPUT) {
    return
  }
  const lines = Object.entries(fields).map(([key, value]) => `${key}=${value}`)
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
}

function headers(accept) {
  const result = { 'User-Agent': 'NitromelonDB-vendor-sqlite3mc', Accept: accept }
  if (process.env.GITHUB_TOKEN) {
    result.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }
  return result
}

async function fetchOk(url, accept) {
  const response = await fetch(url, { headers: headers(accept) })
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status} ${response.statusText}`)
  }
  return response
}

async function fetchJson(url) {
  return (await fetchOk(url, 'application/vnd.github+json')).json()
}

async function fetchText(url) {
  return (await fetchOk(url, 'text/plain')).text()
}

async function fetchBuffer(url) {
  return Buffer.from(await (await fetchOk(url, 'application/octet-stream')).arrayBuffer())
}

async function fetchRelease(version) {
  if (version) {
    return fetchJson(`${API}/releases/tags/v${version}`)
  }
  // /releases/latest already skips drafts and prereleases
  return fetchJson(`${API}/releases/latest`)
}

function parseRelease(release) {
  const version = release.tag_name.replace(/^v/, '')
  if (!/^[0-9]+(\.[0-9]+)*$/.test(version)) {
    throw new Error(`Unexpected sqlite3mc release tag ${release.tag_name}`)
  }
  // sqlite3mc-<version>-sqlite-<sqlite version>-amalgamation.zip
  const prefix = `sqlite3mc-${version}-sqlite-`
  const suffix = '-amalgamation.zip'
  const sqliteVersionOf = (name) =>
    name.startsWith(prefix) && name.endsWith(suffix) ? name.slice(prefix.length, -suffix.length) : null
  const amalgamation = release.assets.find((asset) => /^[0-9]+(\.[0-9]+)*$/.test(sqliteVersionOf(asset.name) ?? ''))
  if (!amalgamation) {
    throw new Error(`sqlite3mc ${version} has no amalgamation zip`)
  }
  const sums = release.assets.find((asset) => asset.name === `sqlite3mc-${version}-SHA256SUMS`)
  if (!sums) {
    throw new Error(`sqlite3mc ${version} has no SHA256SUMS file`)
  }
  const sqliteVersion = sqliteVersionOf(amalgamation.name)
  return { version, sqliteVersion, amalgamation, sums }
}

function expectedChecksum(sumsText, fileName) {
  for (const line of sumsText.split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i)
    if (match && match[2] === fileName) {
      return match[1].toLowerCase()
    }
  }
  throw new Error(`SHA256SUMS does not list ${fileName}`)
}

function unzipKeep(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  // The release zip is flat today. unzip's `*` also matches `/`, so `*name` keeps this
  // working if the zip gains a top-level folder (an unmatched pattern would fail the run).
  execFileSync('unzip', ['-j', '-o', zipPath, ...KEEP_FILES.map((name) => `*${name}`), '-d', destDir], {
    stdio: 'inherit',
  })
}

function removeStaleFiles() {
  if (!fs.existsSync(VENDOR)) {
    return
  }
  for (const name of fs.readdirSync(VENDOR)) {
    if (!OWNED_FILES.has(name)) {
      fs.rmSync(path.join(VENDOR, name), { recursive: true, force: true })
      console.log(`Removed stale native/vendor/sqlite3mc/${name}`)
    }
  }
}

async function vendor({ version, sqliteVersion, amalgamation, sums }) {
  console.log(`Downloading sqlite3mc ${version} (SQLite ${sqliteVersion}) from ${amalgamation.browser_download_url}`)
  const [zip, sumsText, license] = await Promise.all([
    fetchBuffer(amalgamation.browser_download_url),
    fetchText(sums.browser_download_url),
    fetchText(`https://raw.githubusercontent.com/${REPO}/v${version}/LICENSE`),
  ])

  const actual = crypto.createHash('sha256').update(zip).digest('hex')
  const expected = expectedChecksum(sumsText, amalgamation.name)
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${amalgamation.name}: expected ${expected}, got ${actual}`)
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmdb-sqlite3mc-'))
  try {
    const zipPath = path.join(tmp, amalgamation.name)
    fs.writeFileSync(zipPath, zip)
    unzipKeep(zipPath, VENDOR)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  for (const name of KEEP_FILES) {
    if (!fs.existsSync(path.join(VENDOR, name))) {
      throw new Error(`Amalgamation zip did not contain ${name}`)
    }
  }
  removeStaleFiles()

  fs.writeFileSync(path.join(VENDOR, 'LICENSE'), license.endsWith('\n') ? license : `${license}\n`)
  fs.writeFileSync(
    path.join(VENDOR, 'COPYRIGHT'),
    [
      `SQLite3 Multiple Ciphers ${version} (https://github.com/${REPO})`,
      'is MIT licensed, see LICENSE in this directory.',
      '',
      `It is built on SQLite ${sqliteVersion}, which is in the public domain.`,
      'See https://www.sqlite.org/copyright.html',
      '',
    ].join('\n'),
  )
  fs.writeFileSync(MC_VERSION_PATH, `${version}\n`)
  fs.writeFileSync(SQLITE_VERSION_PATH, `${sqliteVersion}\n`)
  console.log(`Vendored sqlite3mc ${version} (SQLite ${sqliteVersion}) into native/vendor/sqlite3mc`)
}

const previous = readVersion(MC_VERSION_PATH)
const previousSqlite = readVersion(SQLITE_VERSION_PATH)
const release = parseRelease(await fetchRelease(wantLatest ? null : versionArg.replace(/^v/, '')))

if (ifNewer && previous && compareVersions(release.version, previous) <= 0) {
  console.log(`Vendored sqlite3mc is already ${previous} (latest ${release.version})`)
  writeGithubOutput({ updated: false, version: previous, sqlite: previousSqlite, previous, previous_sqlite: previousSqlite })
  process.exit(0)
}

await vendor(release)
writeGithubOutput({
  updated: true,
  version: release.version,
  sqlite: release.sqliteVersion,
  previous,
  previous_sqlite: previousSqlite,
})
