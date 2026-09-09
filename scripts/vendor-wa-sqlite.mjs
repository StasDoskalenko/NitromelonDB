#!/usr/bin/env node
/**
 * Vendor wa-sqlite's Asyncify build into src/adapters/sqlite/sqlite-wasm.
 *
 * Unlike native/vendor/sqlite and native/vendor/simdjson, wa-sqlite is not
 * published to npm, so this pulls the prebuilt `dist/wa-sqlite-async.{mjs,wasm}`
 * artifacts directly from a pinned commit of github.com/rhashimoto/wa-sqlite
 * and reapplies the one documented source patch (see VENDOR.md).
 *
 *   node scripts/vendor-wa-sqlite.mjs <commit-sha> [tag]   # bump to a new commit
 *   node scripts/vendor-wa-sqlite.mjs --verify              # check committed files match VENDOR.md and upstream
 */
import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const VENDOR_DIR = path.join(ROOT, 'src', 'adapters', 'sqlite', 'sqlite-wasm')
const MJS_NAME = 'wa-sqlite-async.mjs'
const WASM_NAME = 'wa-sqlite-async.wasm'
const VENDOR_MD_PATH = path.join(VENDOR_DIR, 'VENDOR.md')
const REPO = 'rhashimoto/wa-sqlite'

// The single deliberate source patch, documented in VENDOR.md: Expo Metro
// rewrites `import.meta` to `undefined` in worker chunks, which would crash
// this module-top-level assignment. This build is worker-only, so
// `self.location.href` is an equivalent, safe base.
const PATCH_MARKER = '  var _scriptName = import.meta.url;'
const PATCH_REPLACEMENT = [
  '  // Expo Metro worker chunks currently rewrite import.meta to undefined.',
  '  // This build is worker-only, so the worker script URL is the equivalent base.',
  '  var _scriptName = self.location.href;',
].join('\n')

function usage() {
  console.error('Usage: node scripts/vendor-wa-sqlite.mjs <commit-sha> [tag] | --verify')
  process.exit(2)
}

const args = process.argv.slice(2)
const verifyMode = args.includes('--verify')
const positionals = args.filter((arg) => !arg.startsWith('--'))
const commitArg = positionals[0]
const tagArg = positionals[1]

if (!verifyMode && !commitArg) {
  usage()
}
if (commitArg && !/^[0-9a-f]{40}$/.test(commitArg)) {
  console.error(`Pass a full 40-character commit sha, got: ${commitArg}`)
  process.exit(2)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

// Runs in CI on every push, so tolerate a transient raw.githubusercontent.com blip.
async function fetchWithRetry(url, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'NitromelonDB-vendor-wa-sqlite' },
      })
      if (!response.ok) {
        throw new Error(`${url} -> ${response.status} ${response.statusText}`)
      }
      return response
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
      }
    }
  }
  throw lastError
}

async function fetchText(url) {
  return (await fetchWithRetry(url)).text()
}

async function fetchBuffer(url) {
  return Buffer.from(await (await fetchWithRetry(url)).arrayBuffer())
}

function applyPatch(upstreamSource) {
  const occurrences = upstreamSource.split(PATCH_MARKER).length - 1
  if (occurrences !== 1) {
    throw new Error(
      `Expected exactly one "${PATCH_MARKER.trim()}" line in upstream wa-sqlite-async.mjs, ` +
        `found ${occurrences}. Upstream's Emscripten output shape has changed; update ` +
        'PATCH_MARKER/PATCH_REPLACEMENT in this script before vendoring.',
    )
  }
  return upstreamSource.replace(PATCH_MARKER, PATCH_REPLACEMENT)
}

/** Download + patch the artifacts for one commit. Does not touch the filesystem. */
async function buildArtifacts(commit, tag) {
  const base = `https://raw.githubusercontent.com/${REPO}/${commit}/dist`
  console.log(`Fetching wa-sqlite artifacts from ${base} ...`)
  const [upstreamMjs, wasm] = await Promise.all([
    fetchText(`${base}/${MJS_NAME}`),
    fetchBuffer(`${base}/${WASM_NAME}`),
  ])
  const patchedMjs = applyPatch(upstreamMjs)
  return {
    commit,
    tag,
    wasm,
    patchedMjs,
    upstreamMjsHash: sha256(Buffer.from(upstreamMjs)),
    patchedMjsHash: sha256(Buffer.from(patchedMjs)),
    wasmHash: sha256(wasm),
  }
}

function vendorMdContent({ commit, tag, wasmHash, patchedMjsHash, upstreamMjsHash }) {
  const source = tag ? `tag \`${tag}\` (commit \`${commit}\`)` : `commit \`${commit}\``
  return `# wa-sqlite binary provenance

The Emscripten artifacts in this directory come from rhashimoto/wa-sqlite ${source}.
The runtime JavaScript dependency in \`package.json\` is pinned to that same
immutable commit.

| File | SHA-256 |
| --- | --- |
| \`${WASM_NAME}\` | \`${wasmHash}\` |
| \`${MJS_NAME}\` (patched) | \`${patchedMjsHash}\` |
| upstream \`dist/${MJS_NAME}\` | \`${upstreamMjsHash}\` |

The JavaScript glue has one deliberate source patch: its \`_scriptName\` base is
\`self.location.href\` instead of \`import.meta.url\`. Expo Metro currently rewrites
\`import.meta\` in the emitted worker chunk. This adapter is worker-only and also
supplies \`wasmBinary\` and \`locateFile\`, so the worker URL is the correct safe base.

Regenerate both artifacts and this file with:

\`\`\`
node scripts/vendor-wa-sqlite.mjs <commit-sha>
\`\`\`

CI runs \`node scripts/vendor-wa-sqlite.mjs --verify\` on every push to confirm the
committed artifacts still equal upstream plus exactly that one patch, and that this
file's hashes match. When bumping to a new commit, also update the pinned commit in
\`package.json\`'s \`wa-sqlite\` dependency (\`.yarnrc.yml\`'s \`approvedGitRepositories\`
entry for rhashimoto/wa-sqlite does not need to change), then run the Chromium suite
(\`yarn --cwd examples/NotesApp test:web\`).
`
}

function readCommittedVendorMd() {
  const text = fs.readFileSync(VENDOR_MD_PATH, 'utf8')
  const commitMatch = text.match(/commit `([0-9a-f]{40})`/)
  if (!commitMatch) {
    throw new Error(`Could not find a pinned commit sha in ${VENDOR_MD_PATH}`)
  }

  // Table rows look like `| `name` (suffix) | `hash` |` — pull every
  // backtick-quoted token per line rather than assuming a fixed shape, since
  // the name column carries free text like "(patched)".
  const rows = text
    .split('\n')
    .map((line) => [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]))
    .filter((tokens) => tokens.length === 2 && /^[0-9a-f]{64}$/.test(tokens[1]))

  const hashFor = (predicate) => rows.find(([name]) => predicate(name))?.[1]

  return {
    commit: commitMatch[1],
    wasmHash: hashFor((name) => name.includes(WASM_NAME)),
    patchedMjsHash: hashFor((name) => name.includes(MJS_NAME) && !name.includes('dist/')),
    upstreamMjsHash: hashFor((name) => name.includes(`dist/${MJS_NAME}`)),
  }
}

async function verify() {
  const documented = readCommittedVendorMd()
  const committedWasm = fs.readFileSync(path.join(VENDOR_DIR, WASM_NAME))
  const committedMjs = fs.readFileSync(path.join(VENDOR_DIR, MJS_NAME), 'utf8')
  const committedWasmHash = sha256(committedWasm)
  const committedMjsHash = sha256(Buffer.from(committedMjs))

  const problems = []
  if (committedWasmHash !== documented.wasmHash) {
    problems.push(
      `${WASM_NAME} hash ${committedWasmHash} does not match VENDOR.md (${documented.wasmHash})`,
    )
  }
  if (committedMjsHash !== documented.patchedMjsHash) {
    problems.push(
      `${MJS_NAME} hash ${committedMjsHash} does not match VENDOR.md (${documented.patchedMjsHash})`,
    )
  }

  const fresh = await buildArtifacts(documented.commit)
  if (fresh.wasmHash !== documented.wasmHash) {
    problems.push(
      `Re-downloading ${WASM_NAME} from commit ${documented.commit} gives hash ` +
        `${fresh.wasmHash}, but VENDOR.md says ${documented.wasmHash}. ` +
        'The upstream artifact at this commit no longer matches what was vendored.',
    )
  }
  if (fresh.patchedMjsHash !== documented.patchedMjsHash) {
    problems.push(
      `Re-downloading and re-patching ${MJS_NAME} from commit ${documented.commit} gives ` +
        `hash ${fresh.patchedMjsHash}, but VENDOR.md says ${documented.patchedMjsHash}. ` +
        'Either upstream changed, or the committed file no longer equals ' +
        'upstream + exactly the documented patch.',
    )
  }
  if (fresh.upstreamMjsHash !== documented.upstreamMjsHash) {
    problems.push(
      `Upstream ${MJS_NAME} at commit ${documented.commit} now hashes to ` +
        `${fresh.upstreamMjsHash}, but VENDOR.md says ${documented.upstreamMjsHash}.`,
    )
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const pinnedDep = packageJson.dependencies?.['wa-sqlite'] ?? ''
  if (!pinnedDep.includes(documented.commit)) {
    problems.push(
      `package.json's "wa-sqlite" dependency (${pinnedDep || '<missing>'}) does not ` +
        `reference the commit documented in VENDOR.md (${documented.commit}).`,
    )
  }

  if (problems.length) {
    console.error('wa-sqlite vendor verification failed:\n')
    problems.forEach((problem) => console.error(`  - ${problem}`))
    console.error('\nRun `node scripts/vendor-wa-sqlite.mjs <commit-sha>` to regenerate.')
    process.exit(1)
  }

  console.log(
    `OK: ${MJS_NAME} and ${WASM_NAME} match upstream commit ${documented.commit} ` +
      'plus exactly the documented patch, and VENDOR.md / package.json agree.',
  )
}

async function bump(commit, tag) {
  const artifacts = await buildArtifacts(commit, tag)
  fs.writeFileSync(path.join(VENDOR_DIR, MJS_NAME), artifacts.patchedMjs)
  fs.writeFileSync(path.join(VENDOR_DIR, WASM_NAME), artifacts.wasm)
  fs.writeFileSync(VENDOR_MD_PATH, vendorMdContent(artifacts))
  console.log(`Vendored wa-sqlite from commit ${commit} into ${path.relative(ROOT, VENDOR_DIR)}`)
  console.log('Update the pinned commit in package.json\'s "wa-sqlite" dependency to match,')
  console.log('then run `yarn --cwd examples/NotesApp test:web` before committing.')
}

if (verifyMode) {
  await verify()
} else {
  await bump(commitArg, tagArg)
}
