const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const sharedRoot = path.resolve(projectRoot, '../shared')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [sharedRoot]
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')]
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  expo: path.resolve(projectRoot, 'node_modules/expo'),
  'expo-status-bar': path.resolve(projectRoot, 'node_modules/expo-status-bar'),
}

module.exports = config
