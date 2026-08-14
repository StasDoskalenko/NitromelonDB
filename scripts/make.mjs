#!/usr/bin/env node

import { pipe, filter, map, mapAsync, prop, replace, omit, merge, forEach } from 'rambdax'

import babel from '@babel/core'
import klaw from 'klaw-sync'
import mkdirp from 'mkdirp'
import path from 'path'
import fs from 'fs-extra'
import glob from 'glob'
import { fileURLToPath } from 'url'
import prettyJson from 'json-stringify-pretty-compact'
import chokidar from 'chokidar'
import anymatch from 'anymatch'
import rimraf from 'rimraf'

import { execSync } from 'child_process'

import pkg from './pkg.cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const resolvePath = (...paths) => path.resolve(__dirname, '..', ...paths)
const isDevelopment = process.env.NODE_ENV === 'development'

const SRC_MODULES = 'src'
const CJS_MODULES = 'cjs'

const SOURCE_PATH = resolvePath('src')
const DIST_PATH = resolvePath('dist')
const DEV_PATH = process.env.DEV_PATH || resolvePath('dev')

const DIR_PATH = isDevelopment ? DEV_PATH : DIST_PATH

const DO_NOT_BUILD_PATHS = [
  /__tests__/,
  /__typetests__/,
  /__playground__/,
  /test\.js/,
  /test\.ts/,
  /integrationTest/,
  /__mocks__/,
  /\.DS_Store/,
  /package\.json/,
]

const isNotIncludedInBuildPaths = (value) => !anymatch(DO_NOT_BUILD_PATHS, value)

const cleanFolder = (dir) => rimraf.sync(dir)

const isSourceFile = (value) =>
  (value.endsWith('.js') || value.endsWith('.ts')) &&
  !value.endsWith('.d.ts') &&
  isNotIncludedInBuildPaths(value)

const takeFiles = pipe(prop('path'), isSourceFile)

const takeModules = pipe(filter(takeFiles), map(prop('path')))

const removeSourcePath = replace(SOURCE_PATH, '')

const createModulePath = (format) => {
  const formatPathSegment = format === CJS_MODULES ? [] : [format]
  const modulePath = resolvePath(DIR_PATH, ...formatPathSegment)
  return replace(SOURCE_PATH, modulePath)
}

const createFolder = (dir) => mkdirp.sync(resolvePath(dir))

const babelTransform = (format, file) => {
  if (format === SRC_MODULES) {
    // no transform, just return source
    return fs.readFileSync(file)
  }

  const { code } = babel.transformFileSync(file, {})
  return code
}

const paths = klaw(SOURCE_PATH)
const modules = takeModules(paths)

const toJsOutput = (filename) => filename.replace(/\.tsx?$/, '.js')

const emitDeclarations = (outDir) => {
  execSync(`npx tsc --emitDeclarationOnly --outDir "${outDir}" -p tsconfig.json`, {
    stdio: 'inherit',
    cwd: resolvePath(),
  })
}

const buildModule = (format) => (file) => {
  const modulePath = createModulePath(format)
  const isTypeScript = file.endsWith('.ts') || file.endsWith('.tsx')
  // Ship JS from TypeScript sources in both builds so published `src/` stays valid JS.
  const code = isTypeScript ? babel.transformFileSync(file, {}).code : babelTransform(format, file)
  const filename = toJsOutput(modulePath(file))

  createFolder(path.dirname(filename))
  fs.writeFileSync(filename, code)
}

const prepareJson = pipe(
  omit(['scripts']),
  merge({
    main: './index.js',
    sideEffects: false,
    types: 'index.d.ts',
  }),
  (obj) => prettyJson(obj),
)

const createPackageJson = (dir, obj) => {
  const json = prepareJson(obj)
  fs.writeFileSync(resolvePath(dir, 'package.json'), json)
}

const copyFiles = (dir, files, rm = resolvePath()) =>
  forEach((file) => {
    fs.copySync(file, path.join(dir, replace(rm, '', file)))
  }, files)

const copyNonJavaScriptFiles = (buildPath) => {
  createPackageJson(buildPath, pkg)
  copyFiles(buildPath, [
    'LICENSE',
    // 'README.md',
    'yarn.lock',
    'NitromelonDB.podspec',
    'nitro.json',
    'android/CMakeLists.txt',
    'react-native.config.js', // NOTE: this is needed for autolinking
    // 'docs',
    'native/shared',
    'native/ios',
    'native/android',
    'native/android-jsi',
    'native/nitro',
    'native/windows',
    'nitrogen',
  ])
  cleanFolder(`${buildPath}/native/ios/WatermelonDB.xcodeproj/xcuserdata`)
  cleanFolder(`${buildPath}/native/android/build`)
  cleanFolder(`${buildPath}/native/android/bin/build`)
  cleanFolder(`${buildPath}/native/android-jsi/.cxx`)
  cleanFolder(`${buildPath}/native/android-jsi/.externalNativeBuild`)
  cleanFolder(`${buildPath}/native/android-jsi/build`)
  cleanFolder(`${buildPath}/native/android-jsi/bin/build`)
  cleanFolder(`${buildPath}/native/windows/.vs`)
  cleanFolder(`${buildPath}/native/windows/x64`)
  cleanFolder(`${buildPath}/native/windows/WatermelonDB/Generated Files`)
  cleanFolder(`${buildPath}/native/windows/WatermelonDB/obj`)
  cleanFolder(`${buildPath}/native/windows/WatermelonDB/x64`)
}

if (isDevelopment) {
  const buildCjsModule = buildModule(CJS_MODULES)
  const buildSrcModule = buildModule(SRC_MODULES)

  const buildFile = (file) => {
    if (file.match(/\.tsx?$/) && !file.match(/\.d\.ts$/)) {
      buildSrcModule(file)
      buildCjsModule(file)
    } else if (file.match(/\.js$/)) {
      buildSrcModule(file)
      buildCjsModule(file)
    } else if (file.match(/\.d.ts$/)) {
      // Typescript
      fs.copySync(file, path.join(DEV_PATH, replace(SOURCE_PATH, '', file)))
    } else {
      // native files
      fs.copySync(file, path.join(DEV_PATH, replace(resolvePath(), '', file)))
    }
  }

  cleanFolder(DEV_PATH)
  createFolder(DEV_PATH)
  copyNonJavaScriptFiles(DEV_PATH)
  emitDeclarations(DEV_PATH)

  chokidar
    .watch(
      [
        resolvePath('src'),
        resolvePath('native/ios/WatermelonDB'),
        resolvePath('native/shared'),
        resolvePath('native/android/src/main'),
        resolvePath('native/android-jsi/src/main'),
        resolvePath('native/nitro'),
      ],
      {
        ignored: DO_NOT_BUILD_PATHS,
      },
    )
    .on('all', (event, fileOrDir) => {
      // eslint-disable-next-line
      switch (event) {
        case 'add':
        case 'change':
          // eslint-disable-next-line
          console.log(`✓ ${removeSourcePath(fileOrDir)}`)
          buildFile(fileOrDir)
          break
        default:
          break
      }
    })
} else {
  const buildModules = (format) => mapAsync(buildModule(format))
  const buildCjsModules = buildModules(CJS_MODULES)
  const buildSrcModules = buildModules(SRC_MODULES)

  cleanFolder(DIST_PATH)
  createFolder(DIST_PATH)
  copyNonJavaScriptFiles(DIST_PATH)

  buildSrcModules(modules)
  buildCjsModules(modules)

  emitDeclarations(DIST_PATH)

  // copy remaining hand-written typescript definitions for unconverted modules
  glob(`${SOURCE_PATH}/**/*.d.ts`, {}, (err, files) => {
    files.forEach((file) => {
      fs.copySync(file, path.join(DIST_PATH, replace(SOURCE_PATH, '', file)))
    })
  })
}
