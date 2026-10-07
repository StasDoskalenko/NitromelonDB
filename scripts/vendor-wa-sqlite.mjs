#!/usr/bin/env node
/**
 * Vendor wa-sqlite into src/adapters/sqlite/sqlite-wasm.
 *
 * Unlike native/vendor/sqlite and native/vendor/simdjson, wa-sqlite is not
 * published to npm. Rather than making every NitromelonDB install download the
 * whole upstream repository as a git/URL dependency (~15 MB, mostly demos and
 * docs), this pulls only what the web adapter loads, from a pinned commit of
 * github.com/rhashimoto/wa-sqlite:
 *
 * - the prebuilt `dist/wa-sqlite-async.{mjs,wasm}` artifacts, with the one
 *   documented source patch reapplied to the `.mjs` (see VENDOR.md), and
 * - the JavaScript API + IndexedDB VFS sources the worker imports, byte for
 *   byte, under `vendor/wa-sqlite/` (plus upstream's LICENSE).
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
const SOURCE_VENDOR_DIR = path.join(VENDOR_DIR, 'vendor', 'wa-sqlite')
const MJS_NAME = 'wa-sqlite-async.mjs'
const WASM_NAME = 'wa-sqlite-async.wasm'
const VENDOR_MD_PATH = path.join(VENDOR_DIR, 'VENDOR.md')
const REPO = 'rhashimoto/wa-sqlite'

// Upstream path -> path under vendor/wa-sqlite/. Keeps upstream's relative
// layout so the files' own `./` / `../` imports resolve unchanged. This is the
// full import graph of `sqlite-api.js` and `examples/IDBBatchAtomicVFS.js`.
const SOURCE_FILES = [
  ['LICENSE', 'LICENSE'],
  ['src/sqlite-api.js', 'sqlite-api.js'],
  ['src/sqlite-constants.js', 'sqlite-constants.js'],
  ['src/VFS.js', 'VFS.js'],
  ['src/FacadeVFS.js', 'FacadeVFS.js'],
  ['src/WebLocksMixin.js', 'WebLocksMixin.js'],
  ['src/examples/IDBBatchAtomicVFS.js', 'examples/IDBBatchAtomicVFS.js'],
]

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
  const base = `https://raw.githubusercontent.com/${REPO}/${commit}`
  console.log(`Fetching wa-sqlite artifacts from ${base} ...`)
  const [upstreamMjs, wasm, ...sources] = await Promise.all([
    fetchText(`${base}/dist/${MJS_NAME}`),
    fetchBuffer(`${base}/dist/${WASM_NAME}`),
    ...SOURCE_FILES.map(([upstreamPath]) => fetchBuffer(`${base}/${upstreamPath}`)),
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
    sources: SOURCE_FILES.map(([upstreamPath, vendoredPath], index) => ({
      upstreamPath,
      vendoredPath,
      contents: sources[index],
      hash: sha256(sources[index]),
    })),
  }
}

function vendorMdContent({ commit, tag, wasmHash, patchedMjsHash, upstreamMjsHash, sources }) {
  const source = tag ? `tag \`${tag}\` (commit \`${commit}\`)` : `commit \`${commit}\``
  const sourceRows = sources
    .map(({ vendoredPath, hash }) => `| \`vendor/wa-sqlite/${vendoredPath}\` | \`${hash}\` |`)
    .join('\n')
  return `# wa-sqlite provenance

Everything NitromelonDB's web adapter loads from wa-sqlite is vendored here from
rhashimoto/wa-sqlite ${source}. wa-sqlite is MIT licensed (see
\`vendor/wa-sqlite/LICENSE\`). NitromelonDB does not depend on the \`wa-sqlite\`
package, so installs never download the upstream repository.

| File | SHA-256 |
| --- | --- |
| \`${WASM_NAME}\` | \`${wasmHash}\` |
| \`${MJS_NAME}\` (patched) | \`${patchedMjsHash}\` |
| upstream \`dist/${MJS_NAME}\` | \`${upstreamMjsHash}\` |
${sourceRows}

\`vendor/wa-sqlite/\` holds upstream's JavaScript API (\`sqlite-api.js\`) and the
IndexedDB VFS (\`examples/IDBBatchAtomicVFS.js\`) with its imports, byte for byte
and in upstream's relative layout. Not part of the upstream snapshot: the \`.d.ts\`
files (NitromelonDB's own minimal typings) and \`package.json\`, which only sets
\`"type": "module"\` as upstream's own package.json does.
The build copies \`vendor/\` as-is instead of running it through Babel.

The Emscripten JavaScript glue has one deliberate source patch: its \`_scriptName\`
base is \`self.location.href\` instead of \`import.meta.url\`. Expo Metro currently
rewrites \`import.meta\` in the emitted worker chunk. This adapter is worker-only
and also supplies \`wasmBinary\` and \`locateFile\`, so the worker URL is the correct
safe base.

Regenerate every file above and this file with:

\`\`\`
node scripts/vendor-wa-sqlite.mjs <commit-sha> [tag]
\`\`\`

CI runs \`node scripts/vendor-wa-sqlite.mjs --verify\` on every push to confirm the
committed files still equal upstream (plus exactly that one \`.mjs\` patch) and that
this file's hashes match. After bumping, run the Chromium suite
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
    sourceHashes: Object.fromEntries(
      SOURCE_FILES.map(([, vendoredPath]) => [
        vendoredPath,
        hashFor((name) => name === `vendor/wa-sqlite/${vendoredPath}`),
      ]),
    ),
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

  for (const { upstreamPath, vendoredPath, hash: upstreamHash } of fresh.sources) {
    const label = `vendor/wa-sqlite/${vendoredPath}`
    const documentedHash = documented.sourceHashes[vendoredPath]
    const committedPath = path.join(SOURCE_VENDOR_DIR, vendoredPath)
    if (!documentedHash) {
      problems.push(`VENDOR.md has no hash for ${label}`)
    } else if (upstreamHash !== documentedHash) {
      problems.push(
        `Upstream ${upstreamPath} at commit ${documented.commit} hashes to ${upstreamHash}, ` +
          `but VENDOR.md says ${documentedHash}.`,
      )
    }
    if (!fs.existsSync(committedPath)) {
      problems.push(`${label} is missing`)
    } else if (sha256(fs.readFileSync(committedPath)) !== upstreamHash) {
      problems.push(`${label} differs from upstream ${upstreamPath} (vendored files must be unmodified)`)
    }
  }

  // The whole point of vendoring is that installs never fetch the upstream repo.
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    if (packageJson[field]?.['wa-sqlite']) {
      problems.push(
        `package.json lists "wa-sqlite" in ${field}; import the vendored copy under ` +
          `${path.relative(ROOT, SOURCE_VENDOR_DIR)} instead.`,
      )
    }
  }

  if (problems.length) {
    console.error('wa-sqlite vendor verification failed:\n')
    problems.forEach((problem) => console.error(`  - ${problem}`))
    console.error('\nRun `node scripts/vendor-wa-sqlite.mjs <commit-sha>` to regenerate.')
    process.exit(1)
  }

  console.log(
    `OK: ${MJS_NAME}, ${WASM_NAME} and ${fresh.sources.length} vendored source files match ` +
      `upstream commit ${documented.commit} plus exactly the documented patch.`,
  )
}

async function bump(commit, tag) {
  const artifacts = await buildArtifacts(commit, tag)
  fs.writeFileSync(path.join(VENDOR_DIR, MJS_NAME), artifacts.patchedMjs)
  fs.writeFileSync(path.join(VENDOR_DIR, WASM_NAME), artifacts.wasm)
  for (const { vendoredPath, contents } of artifacts.sources) {
    const target = path.join(SOURCE_VENDOR_DIR, vendoredPath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, contents)
  }
  fs.writeFileSync(VENDOR_MD_PATH, vendorMdContent(artifacts))
  console.log(`Vendored wa-sqlite from commit ${commit} into ${path.relative(ROOT, VENDOR_DIR)}`)
  console.log('Run `yarn --cwd examples/NotesApp test:web` before committing.')
}

if (verifyMode) {
  await verify()
} else {
  await bump(commitArg, tagArg)
}
