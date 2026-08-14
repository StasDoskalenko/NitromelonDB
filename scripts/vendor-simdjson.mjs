#!/usr/bin/env node
/**
 * Vendor the official simdjson amalgamation into native/vendor/simdjson.
 *
 *   node scripts/vendor-simdjson.mjs 3.9.4
 *   node scripts/vendor-simdjson.mjs --latest
 *   node scripts/vendor-simdjson.mjs --latest --if-newer
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const VENDOR = path.join(ROOT, 'native', 'vendor', 'simdjson')
// Not named VERSION: that directory is on the native include path, and a
// case-insensitive volume treats VERSION as C++'s <version> header.
const VERSION_PATH = path.join(VENDOR, 'simdjson.version')
const REPO = 'simdjson/simdjson'

const args = process.argv.slice(2)
const wantLatest = args.includes('--latest')
const ifNewer = args.includes('--if-newer')
const versionArg = args.find((arg) => !arg.startsWith('--'))

function usage() {
  console.error('Usage: node scripts/vendor-simdjson.mjs <version|--latest> [--if-newer]')
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

function githubHeaders(accept = 'application/vnd.github+json') {
  const headers = {
    Accept: accept,
    'User-Agent': 'NitromelonDB-vendor-simdjson',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }
  return headers
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: githubHeaders() })
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status} ${response.statusText}`)
  }
  return response.json()
}

async function fetchBuffer(url, accept) {
  const response = await fetch(url, { headers: githubHeaders(accept) })
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status} ${response.statusText}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function latestVersion() {
  const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`)
  return String(release.tag_name || '').replace(/^v/, '')
}

function assetUrl(release, name) {
  const asset = (release.assets || []).find((item) => item.name === name)
  return asset?.browser_download_url || null
}

function writeGithubOutput(fields) {
  if (!process.env.GITHUB_OUTPUT) {
    return
  }
  const lines = Object.entries(fields).map(([key, value]) => `${key}=${value}`)
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
}

async function vendor(version) {
  const tag = `v${version}`
  const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`)

  const headerUrl =
    assetUrl(release, 'simdjson.h') ||
    `https://raw.githubusercontent.com/${REPO}/${tag}/singleheader/simdjson.h`
  const sourceUrl =
    assetUrl(release, 'simdjson.cpp') ||
    `https://raw.githubusercontent.com/${REPO}/${tag}/singleheader/simdjson.cpp`
  const licenseUrl = `https://raw.githubusercontent.com/${REPO}/${tag}/LICENSE`

  console.log(`Downloading simdjson ${tag}`)
  const [header, source, license] = await Promise.all([
    fetchBuffer(headerUrl, 'application/octet-stream'),
    fetchBuffer(sourceUrl, 'application/octet-stream'),
    fetchBuffer(licenseUrl, 'application/vnd.github.raw'),
  ])

  fs.mkdirSync(VENDOR, { recursive: true })
  fs.writeFileSync(path.join(VENDOR, 'simdjson.h'), header)
  fs.writeFileSync(path.join(VENDOR, 'simdjson.cpp'), source)
  fs.writeFileSync(path.join(VENDOR, 'LICENSE'), license)
  fs.writeFileSync(VERSION_PATH, `${version}\n`)
  console.log(`Vendored simdjson ${version} into native/vendor/simdjson`)
}

const previous = readCurrentVersion()
const version = wantLatest ? await latestVersion() : versionArg.replace(/^v/, '')

if (!version) {
  throw new Error('Could not resolve a simdjson version')
}

if (ifNewer && previous && compareVersions(version, previous) <= 0) {
  console.log(`Vendored simdjson is already ${previous} (latest ${version})`)
  writeGithubOutput({ updated: false, version: previous, previous })
  process.exit(0)
}

await vendor(version)
writeGithubOutput({ updated: true, version, previous })
