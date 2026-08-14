/**
 * Expo config plugin for NitromelonDB.
 *
 * Native SQLite is a Nitro HybridObject and autolinks. This plugin does not
 * wire the old Android JSI Gradle module (`watermelondb-jsi`). It:
 * - appends ProGuard keep rules so release / EAS production minify cannot strip
 *   the JNI loader (`WatermelonDBPackage` → `NitromelonDBOnLoad`)
 * - optionally excludes arm64 from iOS simulator builds (`excludeSimArch`)
 *
 * Evaluated by Expo CLI / EAS Build during `expo prebuild`. Requires Expo in
 * the app; `@expo/config-plugins` comes from that install.
 */

const fs = require('fs')
const path = require('path')

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

const { createRunOncePlugin, withDangerousMod, withXcodeProject } = loadExpoConfigPlugins()

const pkg = require('../package.json')

const PROGUARD_RULES = [
  '-keep class com.nozbe.watermelondb.** { *; }',
  '-keep class com.margelo.nitro.watermelondb.** { *; }',
]

function withProguardRules(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const filePath = path.join(modConfig.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro')
      let contents = ''
      try {
        contents = await fs.promises.readFile(filePath, 'utf8')
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error
        }
      }

      const missing = PROGUARD_RULES.filter((rule) => !contents.includes(rule))
      if (missing.length > 0) {
        const prefix = contents.trimEnd()
        const next = `${prefix ? `${prefix}\n\n` : ''}# nitromelondb\n${missing.join('\n')}\n`
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
        await fs.promises.writeFile(filePath, next)
      }

      return modConfig
    },
  ])
}

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
  let next = withProguardRules(config)
  if (options.excludeSimArch === true) {
    next = withExcludedSimulatorArchitectures(next)
  }
  return next
}

module.exports = createRunOncePlugin(withNitromelonDB, pkg.name, pkg.version)
