// WatermelonDB's JSI adapter on Android isn't autolinked: the app has to include the
// `watermelondb-jsi` Gradle project and register WatermelonDBJSIPackage by hand. Without it,
// `jsi: true` quietly falls back to the asynchronous bridge adapter, so this plugin does both on
// prebuild. The engine line at the top of the app shows which adapter actually runs.
const {
  withAppBuildGradle,
  withMainApplication,
  withSettingsGradle,
} = require('expo/config-plugins')

const PROJECT = ':watermelondb-jsi'

module.exports = function withWatermelonJSIAndroid(config) {
  config = withSettingsGradle(config, (mod) => {
    if (!mod.modResults.contents.includes(PROJECT)) {
      mod.modResults.contents += `
include '${PROJECT}'
project('${PROJECT}').projectDir = new File(rootProject.projectDir, '../node_modules/@nozbe/watermelondb/native/android-jsi')
`
    }
    return mod
  })
  config = withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes(PROJECT)) {
      mod.modResults.contents = mod.modResults.contents.replace(
        /dependencies\s*\{/,
        (match) => `${match}\n    implementation project('${PROJECT}')`,
      )
    }
    return mod
  })
  return withMainApplication(config, (mod) => {
    let contents = mod.modResults.contents
    if (!contents.includes('WatermelonDBJSIPackage')) {
      contents = contents
        .replace(
          /^(package .*\n)/m,
          '$1\nimport com.nozbe.watermelondb.jsi.WatermelonDBJSIPackage\n',
        )
        .replace(
          /PackageList\(this\)\.packages\.apply \{/,
          (match) => `${match}\n          add(WatermelonDBJSIPackage())`,
        )
    }
    mod.modResults.contents = contents
    return mod
  })
}
