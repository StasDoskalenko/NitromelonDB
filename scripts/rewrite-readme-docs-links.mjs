#!/usr/bin/env node

import fs from 'node:fs'

const filePath = process.argv[2]
if (!filePath) {
  throw new Error('usage: node scripts/rewrite-readme-docs-links.mjs <readme.md>')
}

const githubTree = 'https://github.com/StasDoskalenko/NitromelonDB/tree/master/'
const source = fs.readFileSync(filePath, 'utf8')
const rewritten = source.replace(/\]\(\.\/examples\//g, `](${githubTree}examples/`)
fs.writeFileSync(filePath, rewritten, 'utf8')
