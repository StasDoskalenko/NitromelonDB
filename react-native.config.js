const { windowsNativeProject } = require('./windows-autolink')

module.exports = {
  // Library autolinking (consumed from node_modules/nitromelondb)
  dependency: {
    platforms: {
      android: {
        sourceDir: './native/android',
      },
      windows: windowsNativeProject,
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
  },
}
