#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Regenerates native/windows/include/NitroModules/*.hpp.
 *
 * Nitrogen and Nitro C++ include <NitroModules/Foo.hpp>. On iOS/Android a
 * header map provides that prefix. Windows has no such map, so we emit
 * one-line shims that include the real header by basename (the vcxproj
 * already puts every nitro cpp/ subdirectory on the include path).
 *
 * Runs from yarn postinstall and from the Windows vcxproj before compile:
 *   node scripts/windows-nitro-shims.mjs
 *   node scripts/windows-nitro-shims.mjs --optional
 *   node scripts/windows-nitro-shims.mjs --nitro <dir> --out <dir>
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const args = { nitro: '', out: '', optional: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--optional') {
      args.optional = true
    } else if (arg === '--nitro') {
      args.nitro = argv[i + 1]
      i += 1
    } else if (arg === '--out') {
      args.out = argv[i + 1]
      i += 1
    }
  }
  return args
}

function findNitroRoot(explicit, optional) {
  if (explicit) {
    return path.resolve(explicit)
  }
  const candidates = [
    path.join(repoRoot, 'node_modules', 'react-native-nitro-modules'),
    path.join(repoRoot, 'examples', 'NotesApp_windows', 'node_modules', 'react-native-nitro-modules'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate
    }
  }
  if (optional) {
    return null
  }
  throw new Error('react-native-nitro-modules not found. Pass --nitro <dir>.')
}

function collectHeaders(cppRoot) {
  const byName = new Map()
  const stack = [cppRoot]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.name.endsWith('.hpp')) {
        continue
      }
      const existing = byName.get(entry.name)
      if (existing && existing !== full) {
        console.warn(`skip duplicate ${entry.name}: ${full} (keeping ${existing})`)
        continue
      }
      byName.set(entry.name, full)
    }
  }
  return [...byName.keys()].sort()
}

function writeShims(outDir, names) {
  fs.mkdirSync(outDir, { recursive: true })
  for (const name of fs.readdirSync(outDir)) {
    if (name.endsWith('.hpp')) {
      fs.unlinkSync(path.join(outDir, name))
    }
  }
  for (const name of names) {
    const stem = name.slice(0, -'.hpp'.length)
    fs.writeFileSync(path.join(outDir, name), `#pragma once\n#include <${stem}.hpp>\n`, 'utf8')
  }
}

const args = parseArgs(process.argv.slice(2))
const nitroRoot = findNitroRoot(args.nitro, args.optional)
if (!nitroRoot) {
  console.warn('skip Nitro Windows include shims: react-native-nitro-modules is not installed')
  process.exit(0)
}
const cppRoot = path.join(nitroRoot, 'cpp')
if (!fs.existsSync(cppRoot)) {
  throw new Error(`No cpp/ folder in ${nitroRoot}`)
}

const outDir = args.out
  ? path.resolve(args.out)
  : path.join(repoRoot, 'native', 'windows', 'include', 'NitroModules')

const names = collectHeaders(cppRoot)
writeShims(outDir, names)
console.log(`wrote ${names.length} Nitro include shims to ${outDir}`)
