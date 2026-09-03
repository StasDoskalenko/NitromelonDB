const { getDefaultConfig } = require('expo/metro-config')
const fs = require('fs')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// The web conformance screen intentionally imports NitromelonDB's shared
// adapter cases. Expo excludes __tests__ by default, so make those sources
// visible to this example's test bundle.
config.resolver.blockList = config.resolver.blockList.filter(
  (pattern) => !String(pattern).includes('__tests__'),
)

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
  '@nozbe/watermelondb_expect',
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
