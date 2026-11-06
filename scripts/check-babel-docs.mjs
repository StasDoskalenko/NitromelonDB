#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Compiles and runs a decorated model through the Babel configs that
 * docs-website/docs/docs/Installation.mdx tells people to use, so the docs
 * can't drift from what the presets actually need (#182).
 *
 * The configs are read from the doc's own code blocks, not copied here.
 *   - React Native (bare): `@react-native/babel-preset` from the library root
 *   - Expo: `babel-preset-expo` from examples/NotesApp (install it first)
 *
 * Usage: node scripts/check-babel-docs.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const notesAppDir = path.join(repoRoot, 'examples', 'NotesApp')
const docPath = path.join(repoRoot, 'docs-website', 'docs', 'docs', 'Installation.mdx')

// Same shape as a real model: a `!` field (the case that broke in #182), a plain field, a
// static, and private members, which pull in the class-feature plugins. The decorator mimics
// @field: a prototype getter/setter that an own instance property must not shadow.
const modelSource = `
function field(column) {
  return function (target, key, descriptor) {
    return {
      configurable: true,
      enumerable: true,
      get() { return this._raw[column] ?? null },
      set(value) { this._raw[column] = value },
    }
  }
}
class Tx {
  static table = 'tx'
  _raw = {}
  #secret = 1
  @field('amount') amount!: number
  @field('title') title: string
  hasSecret(other: object): boolean { return #secret in other }
}
const tx = new Tx()
tx.amount = 5
tx._raw.title = 'hi'
module.exports = {
  amount: tx.amount,
  rawAmount: tx._raw.amount,
  title: tx.title,
  ownKeys: Object.getOwnPropertyNames(tx),
}
`

function section(doc, startHeading, endHeading) {
  const start = doc.indexOf(`\n${startHeading}\n`)
  const end = doc.indexOf(`\n${endHeading}\n`, start + 1)
  if (start === -1 || end === -1) {
    throw new Error(`Installation.mdx: couldn't find the "${startHeading}" section`)
  }
  return doc.slice(start, end)
}

function babelConfigBlock(text, label) {
  const block = [...text.matchAll(/```js\n([\s\S]*?)```/g)]
    .map((match) => match[1].replace(/^ {3}/gm, ''))
    .find((code) => code.includes('module.exports') && code.includes('presets'))
  if (!block) {
    throw new Error(`Installation.mdx: no babel.config.js block in the ${label} section`)
  }
  const module = { exports: {} }
  new Function('module', 'exports', block)(module, module.exports)
  const config = module.exports
  return typeof config === 'function' ? config({ cache() {} }) : config
}

function check(label, config, appDir, caller) {
  const requireFromApp = createRequire(path.join(appDir, 'package.json'))
  const babel = requireFromApp('@babel/core')
  const { code } = babel.transformSync(modelSource, {
    ...config,
    filename: path.join(appDir, 'BabelDocsCheck.ts'),
    cwd: appDir,
    root: appDir,
    babelrc: false,
    configFile: false,
    caller,
  })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', code)(module, module.exports, requireFromApp)
  const result = module.exports
  const ok =
    result.amount === 5 &&
    result.rawAmount === 5 &&
    result.title === 'hi' &&
    !result.ownKeys.includes('amount') &&
    !result.ownKeys.includes('title')
  if (!ok) {
    throw new Error(
      `${label}: decorated fields don't reach the raw record: ${JSON.stringify(result)}`,
    )
  }
  console.log(`ok: ${label}`)
}

const doc = fs.readFileSync(docPath, 'utf8')
const failures = []
const run = (label, fn) => {
  try {
    fn()
  } catch (error) {
    failures.push(label)
    console.error(`FAIL: ${label}\n  ${String(error.message).split('\n')[0]}`)
  }
}

const bareConfig = babelConfigBlock(
  section(doc, '## React Native (bare)', '## Expo'),
  'React Native (bare)',
)
const expoConfig = babelConfigBlock(section(doc, '## Expo', '### Expo web'), 'Expo')

for (const platform of ['ios', 'android']) {
  run(`React Native (bare) docs config, ${platform}`, () =>
    check(`React Native (bare) docs config, ${platform}`, bareConfig, repoRoot, {
      name: 'metro',
      bundler: 'metro',
      platform,
    }),
  )
}

if (!fs.existsSync(path.join(notesAppDir, 'node_modules', 'babel-preset-expo'))) {
  failures.push('Expo')
  console.error(
    'FAIL: Expo docs config\n  babel-preset-expo is not installed; run yarn install in examples/NotesApp',
  )
} else {
  for (const platform of ['ios', 'android', 'web']) {
    run(`Expo docs config, ${platform}`, () =>
      check(`Expo docs config, ${platform}`, expoConfig, notesAppDir, {
        name: 'metro',
        bundler: 'metro',
        platform,
        engine: platform === 'web' ? undefined : 'hermes',
        isDev: false,
      }),
    )
  }
}

if (failures.length) {
  process.exit(1)
}
