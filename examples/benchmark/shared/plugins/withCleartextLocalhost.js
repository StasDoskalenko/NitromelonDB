// The Realistic sync card talks to the mock server over plain http://localhost (through
// `adb reverse` on Android). Android Release builds block cleartext HTTP by default, so allow it
// in these benchmark apps. iOS already allows local networking in Expo's template.
// shared/ has no node_modules of its own, so resolve Expo from the app being prebuilt
const { withAndroidManifest } = require(
  require.resolve('expo/config-plugins', { paths: [process.cwd()] }),
)

module.exports = function withCleartextLocalhost(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0]
    if (application) {
      application.$['android:usesCleartextTraffic'] = 'true'
    }
    return mod
  })
}
