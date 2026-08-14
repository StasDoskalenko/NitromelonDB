const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// Only the library JS the example imports — watching the whole repo crawls
// iosTest Pods / root node_modules and trips Watchman + Babel resolution.
config.watchFolders = [path.join(workspaceRoot, 'src')]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.extraNodeModules = {
  '@nozbe/watermelondb': workspaceRoot,
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'react-native-nitro-modules': path.resolve(
    projectRoot,
    'node_modules/react-native-nitro-modules',
  ),
}

module.exports = config
