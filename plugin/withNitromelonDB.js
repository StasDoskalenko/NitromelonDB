/**
 * Expo config plugin for NitromelonDB.
 *
 * Native SQLite is a Nitro HybridObject and autolinks. This plugin does not
 * wire the old Android JSI Gradle module (`watermelondb-jsi`).
 * The old React Native architecture is not supported.
 * Optional `{ excludeSimArch: true }` excludes arm64 from iOS simulator builds.
 *
 * Evaluated by Expo CLI / EAS Build during `expo prebuild`. Requires Expo in
 * the app; `@expo/config-plugins` comes from that install.
 */

// Prefer the app's `@expo/config-plugins` (Expo CLI / EAS). A `file:` or
// workspace symlink to this repo would otherwise resolve from the library
// root and miss the app's node_modules.
function loadExpoConfigPlugins() {
  try {
    return require('@expo/config-plugins')
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      throw error
    }
  }
  return require(require.resolve('@expo/config-plugins', { paths: [process.cwd()] }))
}

const { createRunOncePlugin, withXcodeProject } = loadExpoConfigPlugins()

const pkg = require('../package.json')

function setExcludedArchitectures(project) {
  const configurations = project.pbxXCBuildConfigurationSection()
  for (const { buildSettings } of Object.values(configurations || {})) {
    if (typeof buildSettings?.PRODUCT_NAME !== 'undefined') {
      buildSettings['"EXCLUDED_ARCHS[sdk=iphonesimulator*]"'] = '"arm64"'
    }
  }
  return project
}

function withExcludedSimulatorArchitectures(config) {
  return withXcodeProject(config, (modConfig) => {
    modConfig.modResults = setExcludedArchitectures(modConfig.modResults)
    return modConfig
  })
}

/**
 * @param {import('@expo/config-types').ExpoConfig} config
 * @param {{ excludeSimArch?: boolean }} [options]
 */
function withNitromelonDB(config, options = {}) {
  if (config.newArchEnabled === false) {
    throw new Error(
      'NitromelonDB requires the React Native New Architecture. Remove `"newArchEnabled": false` from app.json / app.config.',
    )
  }
  if (options.excludeSimArch === true) {
    return withExcludedSimulatorArchitectures(config)
  }
  return config
}

module.exports = createRunOncePlugin(withNitromelonDB, pkg.name, pkg.version)
