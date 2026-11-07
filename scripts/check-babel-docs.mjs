#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Compiles and runs a decorated model through the Babel configs the docs tell people to use, so
 * the docs can't drift from what the presets actually need (#182).
 *
 * The configs are read from the docs' own code blocks, not copied here:
 *   - Installation.mdx (standard 2023-11 decorators, the recommended setup): bare React Native,
 *     Expo and web
 *   - Advanced/StandardDecorators.md, "Legacy decorators": bare React Native, Expo and web
 *
 * Presets and plugins come from examples/NotesApp (`babel-preset-expo`,
 * `@react-native/babel-preset`, `@babel/plugin-transform-class-static-block`,
 * `@babel/preset-typescript`), so install it first.
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

// Web setups are a `.babelrc`-style JSON block of plugins
function babelJsonBlock(text, label) {
  const block = [...text.matchAll(/```json\n([\s\S]*?)```/g)]
    .map((match) => match[1])
    .find((code) => code.includes('"plugins"'))
  if (!block) {
    throw new Error(`no Babel JSON block for ${label}`)
  }
  return JSON.parse(block)
}

function check({ config, caller, standard }) {
  const requireFromApp = createRequire(path.join(notesAppDir, 'package.json'))
  const babel = requireFromApp('@babel/core')
  const source = (standard ? standardModelSource : legacyModelSource) + modelResult
  const { code } = babel.transformSync(source, {
    ...config,
    filename: path.join(notesAppDir, 'BabelDocsCheck.ts'),
    cwd: notesAppDir,
    root: notesAppDir,
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
const decoratorsDoc = fs.readFileSync(
  path.join(docsDir, 'Advanced', 'StandardDecorators.md'),
  'utf8',
)
const legacySection = () =>
  between(decoratorsDoc, 'StandardDecorators.md', '\n## Legacy decorators\n', '\n## Moving from')

const metroCaller = (platform) => ({ name: 'metro', bundler: 'metro', platform })
const expoCaller = (platform) => ({
  name: 'metro',
  bundler: 'metro',
  platform,
  engine: platform === 'web' ? undefined : 'hermes',
  isDev: false,
})

// kind: 'bare' and 'expo' run each platform through Metro's caller; 'web' runs plain Babel.
const configs = [
  {
    label: 'Installation, React Native (bare)',
    text: () =>
      between(installation, 'Installation.mdx', '\n## React Native (bare)\n', '\n## Expo\n'),
    kind: 'bare',
    standard: true,
  },
  {
    label: 'Installation, Expo',
    text: () => between(installation, 'Installation.mdx', '\n## Expo\n', '\n### Expo web\n'),
    kind: 'expo',
    standard: true,
  },
  {
    label: 'Installation, web',
    text: () => between(installation, 'Installation.mdx', '\n## Web without Expo', '\n## Windows'),
    kind: 'web',
    standard: true,
  },
  {
    label: 'Legacy decorators, React Native (bare)',
    text: () =>
      between(legacySection(), 'StandardDecorators.md', '**Bare React Native:**', '**Web'),
    kind: 'bare',
    standard: false,
  },
  {
    label: 'Legacy decorators, Expo',
    text: () =>
      between(legacySection(), 'StandardDecorators.md', '**Expo:**', '**Bare React Native:**'),
    kind: 'expo',
    standard: false,
  },
  {
    label: 'Legacy decorators, web',
    text: () => between(legacySection(), 'StandardDecorators.md', '**Web', '**TypeScript:**'),
    kind: 'web',
    standard: false,
  },
]

if (!fs.existsSync(path.join(notesAppDir, 'node_modules', 'babel-preset-expo'))) {
  console.error('FAIL: examples/NotesApp is not installed; run yarn install there first')
  process.exit(1)
}

for (const { label, text, kind, standard } of configs) {
  let config
  run(`${label}: config block`, () => {
    if (kind === 'web') {
      config = babelJsonBlock(text(), label)
      // The legacy web config leaves TypeScript to the app's own setup; a typical one compiles
      // it with @babel/preset-typescript (presets run after plugins). The standard config
      // includes the TypeScript plugin itself.
      if (!standard) {
        config = { ...config, presets: ['@babel/preset-typescript'] }
      }
    } else {
      config = babelConfigBlock(text(), label)
    }
  })
  if (!config) {
    continue
  }
  if (kind === 'web') {
    run(`${label}, browser bundle`, () => check({ config, caller: undefined, standard }))
    continue
  }
  for (const platform of kind === 'expo' ? ['ios', 'android', 'web'] : ['ios', 'android']) {
    const caller = kind === 'expo' ? expoCaller(platform) : metroCaller(platform)
    run(`${label}, ${platform}`, () => check({ config, caller, standard }))
  }
}

if (failures.length) {
  process.exit(1)
}
