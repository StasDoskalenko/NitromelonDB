#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Compiles and runs a decorated model through the Babel configs the docs tell people to use, so
 * the docs can't drift from what the presets actually need (#182).
 *
 * The configs are read from the docs' own code blocks, not copied here:
 *   - Installation.mdx (legacy decorators): bare React Native and Expo
 *   - Advanced/StandardDecorators.md (2023-11 decorators): bare React Native and Expo
 *
 * Presets come from the library root (`@react-native/babel-preset`) and examples/NotesApp
 * (`babel-preset-expo`, and the plugins the standard bare config adds), so install both first.
 *
 * Usage: node scripts/check-babel-docs.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const notesAppDir = path.join(repoRoot, 'examples', 'NotesApp')
const docsDir = path.join(repoRoot, 'docs-website', 'docs', 'docs')

// Same shape as a real model: a `!` field (the case that broke in #182), a plain field, a
// static, and private members, which pull in the class-feature plugins. The decorator mimics
// @field: a prototype getter/setter that an own instance property must not shadow.
const legacyModelSource = `
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
`

// The same model for standard decorators: `amount` is an accessor (the getter/setter replaces
// it), `title` a plain field (the per-record fallback for models not migrated yet).
const standardModelSource = `
function field(column) {
  return function (value, context) {
    const get = function () { return this._raw[column] ?? null }
    const set = function (next) { this._raw[column] = next }
    if (context.kind === 'accessor') {
      return { get, set }
    }
    context.addInitializer(function () {
      Object.defineProperty(this, context.name, { configurable: true, enumerable: true, get, set })
    })
  }
}
class Tx {
  static table = 'tx'
  _raw = {}
  #secret = 1
  @field('amount') accessor amount!: number
  @field('title') title!: string
  hasSecret(other: object): boolean { return #secret in other }
}
`

const modelResult = `
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

// Text between `start` and the next `end`, both literal markers in the doc
function between(doc, docName, start, end) {
  const from = doc.indexOf(start)
  const to = doc.indexOf(end, from + start.length)
  if (from === -1 || to === -1) {
    throw new Error(`${docName}: couldn't find "${start}"`)
  }
  return doc.slice(from, to)
}

function babelConfigBlock(text, label) {
  const block = [...text.matchAll(/```js\n([\s\S]*?)```/g)]
    .map((match) => match[1].replace(/^ {3}/gm, ''))
    .find((code) => code.includes('module.exports') && code.includes('presets'))
  if (!block) {
    throw new Error(`no babel.config.js block for ${label}`)
  }
  const module = { exports: {} }
  new Function('module', 'exports', block)(module, module.exports)
  const config = module.exports
  return typeof config === 'function' ? config({ cache() {} }) : config
}

function check({ config, appDir, caller, standard }) {
  const requireFromApp = createRequire(path.join(appDir, 'package.json'))
  const babel = requireFromApp('@babel/core')
  const source = (standard ? standardModelSource : legacyModelSource) + modelResult
  const { code } = babel.transformSync(source, {
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
    // The standard fallback puts the plain field's getter/setter on the instance on purpose
    (standard || !result.ownKeys.includes('title'))
  if (!ok) {
    throw new Error(`decorated fields don't reach the raw record: ${JSON.stringify(result)}`)
  }
}

const failures = []
const run = (label, fn) => {
  try {
    fn()
    console.log(`ok: ${label}`)
  } catch (error) {
    failures.push(label)
    console.error(`FAIL: ${label}\n  ${String(error.message).split('\n')[0]}`)
  }
}

const installation = fs.readFileSync(path.join(docsDir, 'Installation.mdx'), 'utf8')
const standardDoc = fs.readFileSync(path.join(docsDir, 'Advanced', 'StandardDecorators.md'), 'utf8')

const configs = [
  {
    label: 'Installation, React Native (bare)',
    text: () =>
      between(installation, 'Installation.mdx', '\n## React Native (bare)\n', '\n## Expo\n'),
    appDir: repoRoot,
    expo: false,
    standard: false,
  },
  {
    label: 'Installation, Expo',
    text: () => between(installation, 'Installation.mdx', '\n## Expo\n', '\n### Expo web\n'),
    appDir: notesAppDir,
    expo: true,
    standard: false,
  },
  {
    label: 'Standard decorators, React Native (bare)',
    text: () =>
      between(standardDoc, 'StandardDecorators.md', '**Bare React Native:**', '**TypeScript:**'),
    // @babel/plugin-transform-class-static-block isn't a root dependency; NotesApp has it, and
    // the same @react-native/babel-preset major
    appDir: notesAppDir,
    expo: false,
    standard: true,
  },
  {
    label: 'Standard decorators, Expo',
    text: () =>
      between(standardDoc, 'StandardDecorators.md', '**Expo:**', '**Bare React Native:**'),
    appDir: notesAppDir,
    expo: true,
    standard: true,
  },
]

const notesAppInstalled = fs.existsSync(path.join(notesAppDir, 'node_modules', 'babel-preset-expo'))

for (const { label, text, appDir, expo, standard } of configs) {
  if (appDir === notesAppDir && !notesAppInstalled) {
    run(label, () => {
      throw new Error('examples/NotesApp is not installed; run yarn install there first')
    })
    continue
  }
  let config
  run(`${label}: config block`, () => {
    config = babelConfigBlock(text(), label)
  })
  if (!config) {
    continue
  }
  for (const platform of expo ? ['ios', 'android', 'web'] : ['ios', 'android']) {
    const caller = expo
      ? {
          name: 'metro',
          bundler: 'metro',
          platform,
          engine: platform === 'web' ? undefined : 'hermes',
          isDev: false,
        }
      : { name: 'metro', bundler: 'metro', platform }
    run(`${label}, ${platform}`, () => check({ config, appDir, caller, standard }))
  }
}

if (failures.length) {
  process.exit(1)
}
