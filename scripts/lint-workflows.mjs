#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Lint GitHub Actions workflows with actionlint + action-validator.
 *
 * actionlint catches semantic mistakes (unknown `needs:` jobs, expressions).
 * action-validator checks YAML against the GitHub workflow JSON schema.
 * There is no widely used CLI named "workflowlint"; action-validator is that
 * schema check. It has no Windows binary, so Windows runs actionlint only.
 *
 * Binaries are downloaded into `.cache/workflow-lint/` (gitignored).
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'workflow-lint')
const WORKFLOWS_DIR = path.join(ROOT, '.github', 'workflows')

const ACTIONLINT_VERSION = '1.7.12'
const ACTION_VALIDATOR_VERSION = '0.9.0'

const ACTIONLINT_ARCHIVES = {
  'win32-x64': {
    file: `actionlint_${ACTIONLINT_VERSION}_windows_amd64.zip`,
    sha256: '6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9',
    binary: 'actionlint.exe',
  },
  'win32-arm64': {
    file: `actionlint_${ACTIONLINT_VERSION}_windows_arm64.zip`,
    sha256: 'cadcf7ea4efe3a68728893813643cebe1185e5b1d4be5b96245f65c9a4d5ea41',
    binary: 'actionlint.exe',
  },
  'linux-x64': {
    file: `actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz`,
    sha256: '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
    binary: 'actionlint',
  },
  'linux-arm64': {
    file: `actionlint_${ACTIONLINT_VERSION}_linux_arm64.tar.gz`,
    sha256: '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
    binary: 'actionlint',
  },
  'darwin-x64': {
    file: `actionlint_${ACTIONLINT_VERSION}_darwin_amd64.tar.gz`,
    sha256: '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
    binary: 'actionlint',
  },
  'darwin-arm64': {
    file: `actionlint_${ACTIONLINT_VERSION}_darwin_arm64.tar.gz`,
    sha256: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
    binary: 'actionlint',
  },
}

const ACTION_VALIDATOR_BINARIES = {
  'linux-x64': {
    file: 'action-validator_linux_amd64',
    sha256: '9f42f94fca5b8d04c13bccfbb331104b37a9250650d89ae58dc888d46206f9b9',
  },
  'linux-arm64': {
    file: 'action-validator_linux_arm64',
    sha256: '0fe137986e838c68f760d9a60569cf6749192fa6315915f19ba0c7d11d8e3d9a',
  },
  'darwin-x64': {
    file: 'action-validator_darwin_amd64',
    sha256: 'b64010874b70e7e65e3ccd767d6b1c6e6d3a82a5a43748ddd9be2c817970a41d',
  },
  'darwin-arm64': {
    file: 'action-validator_darwin_arm64',
    sha256: '1451a573f8d51ade3d21de7b02cc8a6fcc87b0936e9feb617d197f568b879f6b',
  },
}

function platformKey() {
  const arch = process.arch === 'x64' || process.arch === 'arm64' ? process.arch : null
  if (!arch) {
    throw new Error(`Unsupported architecture: ${process.arch}`)
  }
  return `${process.platform}-${arch}`
}

async function download(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'NitromelonDB-lint-workflows' },
    redirect: 'follow',
  })
  if (!response.ok) {
    throw new Error(`Download failed ${response.status} ${url}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

function assertSha256(buffer, expected, label) {
  const actual = createHash('sha256').update(buffer).digest('hex')
  if (actual !== expected) {
    throw new Error(`${label} checksum mismatch\n  expected ${expected}\n  actual   ${actual}`)
  }
}

function extractArchive(archivePath, destDir) {
  mkdirSync(destDir, { recursive: true })
  execFileSync('tar', ['-xf', archivePath, '-C', destDir], { stdio: 'inherit' })
}

async function ensureActionlint() {
  const spec = ACTIONLINT_ARCHIVES[platformKey()]
  if (!spec) {
    throw new Error(`No actionlint ${ACTIONLINT_VERSION} build for ${platformKey()}`)
  }
  const dir = path.join(CACHE, `actionlint-${ACTIONLINT_VERSION}`)
  const binary = path.join(dir, spec.binary)
  if (existsSync(binary)) {
    return binary
  }

  mkdirSync(dir, { recursive: true })
  const url = `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${spec.file}`
  console.log(`Downloading actionlint ${ACTIONLINT_VERSION}…`)
  const archive = await download(url)
  assertSha256(archive, spec.sha256, spec.file)
  const archivePath = path.join(dir, spec.file)
  writeFileSync(archivePath, archive)
  extractArchive(archivePath, dir)
  if (!existsSync(binary)) {
    throw new Error(`actionlint binary missing after extract: ${binary}`)
  }
  return binary
}

async function ensureActionValidator() {
  const spec = ACTION_VALIDATOR_BINARIES[platformKey()]
  if (!spec) {
    return null
  }
  const dir = path.join(CACHE, `action-validator-${ACTION_VALIDATOR_VERSION}`)
  const binary = path.join(dir, process.platform === 'win32' ? 'action-validator.exe' : 'action-validator')
  if (existsSync(binary)) {
    return binary
  }

  mkdirSync(dir, { recursive: true })
  const url = `https://github.com/mpalmer/action-validator/releases/download/v${ACTION_VALIDATOR_VERSION}/${spec.file}`
  console.log(`Downloading action-validator ${ACTION_VALIDATOR_VERSION}…`)
  const payload = await download(url)
  assertSha256(payload, spec.sha256, spec.file)
  writeFileSync(binary, payload)
  chmodSync(binary, 0o755)
  return binary
}

function workflowFiles(dir = WORKFLOWS_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => path.join(dir, name))
    .sort()
}

function runCaptured(binary, args, cwd) {
  try {
    execFileSync(binary, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
    return { ok: true, output: '' }
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`
    return { ok: false, output, status: error.status }
  }
}

function runActionlint(binary, files, cwd = ROOT) {
  console.log('actionlint')
  execFileSync(binary, ['-color', ...files], { cwd, stdio: 'inherit' })
}

function runActionValidator(binary, files, cwd = ROOT) {
  if (!binary) {
    console.log(
      'action-validator: skipped (no Windows binary; CI on Ubuntu still runs the schema check)',
    )
    return
  }
  console.log('action-validator')
  for (const file of files) {
    execFileSync(binary, [file], { cwd, stdio: 'inherit' })
  }
}

function selfTest(actionlintBinary) {
  const dir = path.join(tmpdir(), `nitromelondb-workflow-lint-${process.pid}`)
  mkdirSync(dir, { recursive: true })
  const broken = path.join(dir, 'broken.yml')
  writeFileSync(
    broken,
    `name: broken
on: push
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - run: echo hi
  follow:
    needs: windows-build
    runs-on: ubuntu-24.04
    steps:
      - run: echo hi
`,
  )
  const result = runCaptured(actionlintBinary, [broken], dir)
  if (result.ok) {
    throw new Error('self-test: actionlint accepted a workflow with needs: windows-build missing')
  }
  if (!/windows-build/.test(result.output)) {
    throw new Error(`self-test: expected actionlint to mention windows-build\n${result.output}`)
  }
  console.log('self-test: actionlint rejects a missing needs: job')
}

async function main() {
  const files = workflowFiles()
  if (files.length === 0) {
    throw new Error(`No workflow files in ${WORKFLOWS_DIR}`)
  }

  const actionlint = await ensureActionlint()
  selfTest(actionlint)
  runActionlint(actionlint, files)

  const actionValidator = await ensureActionValidator()
  runActionValidator(actionValidator, files)

  console.log(`ok: ${files.length} workflow file(s)`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
