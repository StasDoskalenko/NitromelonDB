#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import klaw from 'klaw-sync'

const require = createRequire(import.meta.url)
const { transform } = require('../native/metro-transformer.js')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'src')

const files = klaw(src, { nodir: true })
  .map((entry) => entry.path)
  .filter(
    (file) =>
      (file.endsWith('.ts') || file.endsWith('.tsx')) &&
      !file.endsWith('.d.ts') &&
      !file.includes('__typetests__') &&
      !file.includes('__playground__'),
  )
  .sort()

if (!files.length) {
  throw new Error('No TypeScript sources found to transform')
}

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  try {
    const result = transform({
      src: source,
      filename: file,
      options: { projectRoot: root, platform: 'ios' },
    })
    if (!result || !result.ast) {
      throw new Error('transformer returned no AST')
    }
  } catch (error) {
    console.error(`Metro transform failed: ${path.relative(root, file)}`)
    throw error
  }
}

console.log(`Metro transformer OK (${files.length} TypeScript files)`)
