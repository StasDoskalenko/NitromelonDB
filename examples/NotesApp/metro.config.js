const { getDefaultConfig } = require('expo/metro-config')
const fs = require('fs')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

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
const libraryDeps = ['rxjs', 'sql-escape-string', 'hoist-non-react-statics', '@babel/runtime']

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
