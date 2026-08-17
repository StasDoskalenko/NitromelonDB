'use strict'

/**
 * React Native Windows autolinking for NitromelonDB.
 *
 * Library `react-native.config.js` already points RNW at `native/windows`.
 * Apps still need this helper because `react-native-nitro-modules` has no
 * Windows project yet (https://github.com/mrousavy/nitro/issues/168).
 * NitromelonDB's WinAppSDK DLL implements `NitroModules.install()` and
 * registers `HybridNitromelon` in the same binary.
 *
 * Spread into the app's `react-native.config.js`:
 *
 *   const { windowsAppDependencies } = require('nitromelondb/windows-autolink')
 *   module.exports = {
 *     dependencies: windowsAppDependencies(),
 *   }
 *
 * Pass `{ root }` only for a `file:` / monorepo link of nitromelondb.
 */

const windowsNativeProject = {
  sourceDir: '.\\native\\windows',
  solutionFile: 'NitromelonDB.sln',
  projects: [
    {
      projectFile: 'NitromelonDB\\NitromelonDB.vcxproj',
      directDependency: true,
    },
  ],
}

function windowsAppDependencies(options = {}) {
  const dependencies = {
    'react-native-nitro-modules': {
      platforms: {
        windows: null,
      },
    },
  }

  if (options.root) {
    dependencies.nitromelondb = { root: options.root }
  }

  return dependencies
}

module.exports = {
  windowsNativeProject,
  windowsAppDependencies,
}
