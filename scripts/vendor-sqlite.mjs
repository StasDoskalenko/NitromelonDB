#!/usr/bin/env node
/**
 * Vendor the official SQLite amalgamation into native/vendor/sqlite.
 * iOS keeps linking the system sqlite3; Android and Windows compile these sources.
 *
 *   node scripts/vendor-sqlite.mjs 3.46.0
 *   node scripts/vendor-sqlite.mjs --latest
 *   node scripts/vendor-sqlite.mjs --latest --if-newer
 */
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const VENDOR = path.join(ROOT, 'native', 'vendor', 'sqlite')
// Not named VERSION: that directory is on the native include path, and a
// case-insensitive volume treats VERSION as C++'s <version> header.
const VERSION_PATH = path.join(VENDOR, 'sqlite.version')
const DOWNLOAD_PAGE = 'https://sqlite.org/download.html'
const KEEP_FILES = ['sqlite3.c', 'sqlite3.h', 'sqlite3ext.h']

const args = process.argv.slice(2)
const wantLatest = args.includes('--latest')
const ifNewer = args.includes('--if-newer')
const versionArg = args.find((arg) => !arg.startsWith('--'))

function usage() {
  console.error('Usage: node scripts/vendor-sqlite.mjs <version|--latest> [--if-newer]')
  process.exit(2)
}

if (!wantLatest && !versionArg) {
  usage()
}

function readCurrentVersion() {
  try {
    return fs.readFileSync(VERSION_PATH, 'utf8').trim()
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

function amalgamationId(version) {
  const [major, minor, patch = 0, branch = 0] = version.split('.').map((part) => Number.parseInt(part, 10) || 0)
  return `${major}${String(minor).padStart(2, '0')}${String(patch).padStart(2, '0')}${String(branch).padStart(2, '0')}`
}

function writeGithubOutput(fields) {
  if (!process.env.GITHUB_OUTPUT) {
    return
  }
  const lines = Object.entries(fields).map(([key, value]) => `${key}=${value}`)
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'NitromelonDB-vendor-sqlite' } })
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status} ${response.statusText}`)
  }
  return response.text()
}

async function fetchBuffer(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'NitromelonDB-vendor-sqlite' } })
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status} ${response.statusText}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

function parseDownloadProducts(html) {
  const products = []
  for (const line of html.split(/\r?\n/)) {
    if (!line.startsWith('PRODUCT,')) {
      continue
    }
    const cols = line.split(',')
    const version = cols[1]
    const relativeUrl = cols[2]
    if (version && relativeUrl?.includes('sqlite-amalgamation-') && relativeUrl.endsWith('.zip')) {
      products.push({ version, relativeUrl })
    }
  }
  return products
}

async function catalog() {
  const html = await fetchText(DOWNLOAD_PAGE)
  return parseDownloadProducts(html)
}

async function latestRelease() {
  const products = await catalog()
  if (products.length === 0) {
    throw new Error('Could not find sqlite-amalgamation on sqlite.org/download.html')
  }
  return products[0]
}

async function zipUrlFor(version) {
  const id = amalgamationId(version)
  const products = await catalog()
  const match = products.find((item) => item.version === version || item.relativeUrl.includes(`sqlite-amalgamation-${id}.zip`))
  if (match) {
    return `https://www.sqlite.org/${match.relativeUrl}`
  }

  const thisYear = new Date().getUTCFullYear()
  const years = []
  for (let year = thisYear + 1; year >= 2018; year -= 1) {
    years.push(year)
  }
  for (const year of years) {
    const url = `https://www.sqlite.org/${year}/sqlite-amalgamation-${id}.zip`
    const response = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'NitromelonDB-vendor-sqlite' } })
    if (response.ok) {
      return url
    }
  }
  throw new Error(`Could not find sqlite-amalgamation zip for ${version} (${id})`)
}

function unzipKeep(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  execFileSync('unzip', ['-j', '-o', zipPath, ...KEEP_FILES.map((name) => `*/${name}`), '-d', destDir], {
    stdio: 'inherit',
  })
}

async function vendor(version) {
  const url = await zipUrlFor(version)
  console.log(`Downloading SQLite ${version} from ${url}`)
  const zip = await fetchBuffer(url)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nmdb-sqlite-'))
  try {
    const zipPath = path.join(tmp, 'sqlite-amalgamation.zip')
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

  fs.writeFileSync(
    path.join(VENDOR, 'COPYRIGHT'),
    'SQLite is in the public domain.\nSee https://www.sqlite.org/copyright.html\n',
  )
  fs.writeFileSync(VERSION_PATH, `${version}\n`)
  console.log(`Vendored SQLite ${version} into native/vendor/sqlite`)
}

const previous = readCurrentVersion()
const version = wantLatest ? (await latestRelease()).version : versionArg.replace(/^v/, '')

if (!version) {
  throw new Error('Could not resolve a SQLite version')
}

if (ifNewer && previous && compareVersions(version, previous) <= 0) {
  console.log(`Vendored SQLite is already ${previous} (latest ${version})`)
  writeGithubOutput({ updated: false, version: previous, previous })
  process.exit(0)
}

await vendor(version)
writeGithubOutput({ updated: true, version, previous })
