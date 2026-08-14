const path = require('path')

module.exports = {
  // Library autolinking (consumed from node_modules/nitromelondb)
  dependency: {
    platforms: {
      ios: {
        podspecPath: path.join(__dirname, 'NitromelonDB.podspec'),
      },
      android: {
        sourceDir: './native/android',
      },
      windows: {
        sourceDir: '.\\native\\windows',
        solutionFile: 'WatermelonDB.sln',
        projects: [
          {
            projectFile: 'WatermelonDB\\WatermelonDB.vcxproj',
            directDependency: true,
          },
        ],
      },
    },
  },
  // Tester app in this repo: simdjson is compiled into NitromelonDB.podspec.
  dependencies: {
    '@nozbe/simdjson': {
      platforms: {
        ios: null,
      },
    },
  },
  // This is for WatermelonDB project internals
  project: {
    android: {
      sourceDir: './native/androidTest',
    },
    ios: {
      sourceDir: './native/iosTest',
    },
    windows: {
      sourceDir: 'native\\windowsTest',
      solutionFile: 'WatermelonTester.sln',
      project: {
        projectFile: 'WatermelonTester\\WatermelonTester.vcxproj',
      },
    },
  },
}
