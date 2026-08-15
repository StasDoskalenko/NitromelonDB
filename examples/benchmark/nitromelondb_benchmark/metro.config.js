const { getDefaultConfig } = require('expo/metro-config')
const fs = require('fs')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../../..')
const sharedRoot = path.resolve(projectRoot, '../shared')

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

const libraryDeps = ['rxjs', 'sql-escape-string', 'hoist-non-react-statics', '@babel/runtime']

config.watchFolders = [
  path.join(workspaceRoot, 'src'),
  sharedRoot,
  ...libraryDeps.map(resolveDep).filter((dir) => fs.existsSync(dir)),
]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.extraNodeModules = {
  nitromelondb: path.join(workspaceRoot, 'src'),
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'react-native-nitro-modules': path.resolve(
    projectRoot,
    'node_modules/react-native-nitro-modules',
  ),
  expo: path.resolve(projectRoot, 'node_modules/expo'),
  'expo-status-bar': path.resolve(projectRoot, 'node_modules/expo-status-bar'),
  ...Object.fromEntries(libraryDeps.map((name) => [name, resolveDep(name)])),
}

module.exports = config
