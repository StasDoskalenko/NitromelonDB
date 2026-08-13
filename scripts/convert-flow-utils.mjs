#!/usr/bin/env node

import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import klaw from 'klaw-sync'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UTILS = path.resolve(__dirname, '../src/utils')

const isTest = (file) =>
  file.includes('__tests__') ||
  file.includes('__typetests__') ||
  /(^|[\\/])test\.js$/.test(file) ||
  file.endsWith('.test.js')

const postprocess = (code) =>
  code
    .replace(/\(\.\.\.:\s*any\)/g, '(...args: any[])')
    .replace(/\(\.\.\.any\)/g, '(...args: any[])')
    .replace(/\$FlowFixMe/g, 'ts-expect-error -- migrated from Flow')

const files = klaw(UTILS, { nodir: true })
  .map((entry) => entry.path)
  .filter((file) => file.endsWith('.js') && !isTest(file))
  .sort()

let failed = 0

for (const file of files) {
  const out = file.replace(/\.js$/, '.ts')
  if (fs.existsSync(out)) {
    console.log(`skip (already ts): ${path.relative(UTILS, file)}`)
    const dts = file.replace(/\.js$/, '.d.ts')
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
    }
    if (fs.existsSync(dts)) {
      fs.unlinkSync(dts)
    }
    continue
  }

  try {
    const ts = execFileSync(
      'npx',
      [
        '@khanacademy/flow-to-ts',
        '--inline-utility-types',
        '--print-width',
        '100',
        file,
      ],
      { encoding: 'utf8' },
    )
    fs.writeFileSync(out, postprocess(ts))
    fs.unlinkSync(file)
    const dts = file.replace(/\.js$/, '.d.ts')
    if (fs.existsSync(dts)) {
      fs.unlinkSync(dts)
    }
    console.log(`converted: ${path.relative(UTILS, file)}`)
  } catch (error) {
    failed += 1
    console.error(`FAILED: ${path.relative(UTILS, file)}`)
    console.error(error.stdout || error.message)
  }
}

if (failed) {
  process.exit(1)
}
