const { withPodfile } = require('expo/config-plugins')

const POD_MARKER = "pod 'simdjson'"

const POD_SNIPPET = `
  simdjson_dir = File.dirname(Pod::Executable.execute_command('node', ['-p',
    'require.resolve("@nozbe/simdjson/package.json", {paths:[process.argv[1]]})',
    File.expand_path('..', __dir__),
  ]).strip)
  pod 'simdjson', :path => simdjson_dir, :modular_headers => true, :inhibit_warnings => true
`

/**
 * Nitrogen sets DEFINES_MODULE on NitromelonDB, so simdjson must define modules.
 * Autolinking is disabled for simdjson on iOS (see react-native.config.js) to
 * avoid adding the same pod twice without modular_headers.
 */
function withSimdjsonModularHeaders(config) {
  return withPodfile(config, (config) => {
    if (config.modResults.contents.includes(POD_MARKER)) {
      return config
    }
    config.modResults.contents = config.modResults.contents.replace(
      /target ['"][^'"]+['"] do\n/,
      (match) => `${match}${POD_SNIPPET}`,
    )
    return config
  })
}

module.exports = withSimdjsonModularHeaders
