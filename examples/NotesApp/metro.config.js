const { getDefaultConfig } = require('expo/metro-config')
const fs = require('fs')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// The web conformance screen intentionally imports NitromelonDB's shared
// adapter cases from `src/adapters/__tests__` (and their transitive `__tests__`
// imports elsewhere under the library's `src/`). Expo's default blockList
// excludes every `__tests__` directory, plus `.expo/types` and `.expo/web/cache`,
// in one combined pattern. Dropping that whole pattern also unblocks `__tests__`
// inside every installed package and drops the `.expo/*` exclusions as collateral.
// Instead, keep blocking `__tests__` under `node_modules` (where Expo's default is
// genuinely useful, e.g. broken fixtures or huge snapshots in a dependency's own
// test folder) and keep the `.expo/*` exclusions, while leaving this workspace's
// own `src/` alone. `nitromelondb`'s `src/` is resolved directly via
// `extraNodeModules`/`watchFolders` below, never through a real
// `node_modules/nitromelondb` path, so anchoring on `node_modules` targets
// third-party packages precisely. This stays a positive match rather than a
// `src/`-relative negative lookahead: Metro can hand combined blockList patterns
// to Watchman's regex engine, which does not reliably support lookahead, and a
// pattern Watchman mishandles fails silently by excluding files from the crawl.
config.resolver.blockList = config.resolver.blockList.flatMap((pattern) => {
  if (!String(pattern).includes('__tests__')) {
    return [pattern]
  }
  return [
    /[\\/]\.expo[\\/](?:types|web[\\/]cache)$/,
    /[\\/]node_modules[\\/].*[\\/]__tests__[\\/].*$/,
  ]
})

function resolveDep(name) {
  const local = path.resolve(projectRoot, 'node_modules', name)
  const workspace = path.resolve(workspaceRoot, 'node_modules', name)
  if (fs.existsSync(local)) {
    return local
  }
  if (fs.existsSync(workspace)) {
    return workspace
  }
  return local
}

// JS deps of nitromelondb. Metro only indexes projectRoot + watchFolders,
// so src/ imports of rxjs fail unless those packages are watched too.
const libraryDeps = [
  'rxjs',
  'sql-escape-string',
  'hoist-non-react-statics',
  '@babel/runtime',
  'wa-sqlite',
  'big-list-of-naughty-strings',
  'rambdax',
]

// NitromelonDB's web SQLite adapter packages its Asyncify WASM binary as an
// asset. Keep this explicit so custom Metro configurations don't drop it.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm')
}

config.watchFolders = [
  path.join(workspaceRoot, 'src'),
  ...libraryDeps.map(resolveDep).filter((dir) => fs.existsSync(dir)),
]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.extraNodeModules = {
  'nitromelondb': path.join(workspaceRoot, 'src'),
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'react-native-nitro-modules': path.resolve(
    projectRoot,
    'node_modules/react-native-nitro-modules',
  ),
  ...Object.fromEntries(libraryDeps.map((name) => [name, resolveDep(name)])),
}

module.exports = config
