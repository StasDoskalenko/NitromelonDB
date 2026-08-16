#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Shape of package.json written into dist/ (the npm tarball).
 *
 * Root package.json keeps `"types": "src/index.ts"` for in-repo TypeScript.
 * The published tarball compiles JS next to `index.d.ts` and does not include
 * `.ts` sources, so that field must be overwritten here.
 *
 * Do not use Ramda `merge(defaults)(pkg)` for this: `merge` is `merge(a, b)`
 * with `b` winning, so the root `"types": "src/index.ts"` would clobber
 * `"index.d.ts"`.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSourceFile } from './source-files.mjs'

const SUBPATH_EXPORT = {
  types: './*/index.d.ts',
  default: './*/index.js',
}

export const PUBLISHED_EXPORTS = {
  '.': {
    types: './index.d.ts',
    default: './index.js',
  },
  './package.json': './package.json',
  './app.plugin.js': './app.plugin.js',
  './*': SUBPATH_EXPORT,
}

export function preparePublishedPackageJson(pkg) {
  const rest = { ...pkg }
  delete rest.scripts
  delete rest.bin
  return {
    ...rest,
    main: './index.js',
    types: './index.d.ts',
    sideEffects: false,
    exports: PUBLISHED_EXPORTS,
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function runSelfTest() {
  const fakePkg = {
    name: 'nitromelondb',
    types: 'src/index.ts',
    scripts: { build: 'true' },
    bin: { fake: './bin.js' },
    dependencies: { rxjs: '^7.8.0' },
    peerDependencies: {
      'react-native-nitro-modules': '>=0.35.2',
    },
  }

  const published = preparePublishedPackageJson(fakePkg)

  assert(published.types === './index.d.ts', `types must be ./index.d.ts, got ${published.types}`)
  assert(published.main === './index.js', `main must be ./index.js, got ${published.main}`)
  assert(published.sideEffects === false, 'sideEffects must be false')
  assert(published.scripts === undefined, 'scripts must be omitted')
  assert(published.bin === undefined, 'bin must be omitted')
  assert(published.exports['.'].types === './index.d.ts', 'exports["."] types must be ./index.d.ts')
  assert(published.exports['./decorators'] === undefined, 'directory imports go through ./*')
  assert(published.exports['./*'].types === './*/index.d.ts', 'subpath types must resolve */index.d.ts')
  assert(published.exports['./app.plugin.js'] === './app.plugin.js', 'Expo plugin export missing')
  assert(published.name === 'nitromelondb', 'package name must be preserved')

  assert(isSourceFile('/src/react/withDatabase.tsx'), '.tsx files must be compiled into the tarball')
  assert(isSourceFile('/src/react/DatabaseProvider.tsx'), '.tsx files must be compiled into the tarball')
  assert(isSourceFile('/src/react/index.ts'), '.ts files must be compiled')
  assert(!isSourceFile('/src/react/index.d.ts'), '.d.ts files are not Babel inputs')
  assert(!isSourceFile('/src/react/DatabaseProvider.test.js'), 'tests must not be compiled')

  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')
  const requiredTsx = ['react/withDatabase.tsx', 'react/DatabaseProvider.tsx']
  for (const rel of requiredTsx) {
    const abs = path.join(srcRoot, rel)
    assert(isSourceFile(abs), `${rel} would be skipped by the JS build`)
  }

  console.log('ok    types overwritten to ./index.d.ts')
  console.log('ok    scripts/bin omitted')
  console.log('ok    exports map present')
  console.log('ok    .tsx sources are included in the JS build')
  console.log('\n4 tests passed')
}

const isDirectRun =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun && process.argv.includes('--self-test')) {
  try {
    runSelfTest()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
