// Lets release builds talk to the local example sync server over plain http://
// (src/sync.ts, maestro/sync.yaml). Android blocks cleartext traffic in release builds since
// API 28; iOS allows it to 127.0.0.1 / localhost through Expo's default NSAllowsLocalNetworking.
// An app talking to a real server over https:// doesn't need this.
const { withAndroidManifest } = require('expo/config-plugins')

module.exports = function withLocalSyncServer(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const application = manifestConfig.modResults.manifest.application?.[0]
    if (application) {
      application.$['android:usesCleartextTraffic'] = 'true'
    }
    return manifestConfig
  })
}
