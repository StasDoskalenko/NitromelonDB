require "json"

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# Vendored amalgamation from https://github.com/simdjson/simdjson (see native/vendor/simdjson).
# `s.dependency "simdjson"` would resolve CocoaPods trunk, which is the wrong library.

# SQLite (see native/shared/NitromelonSqliteConfig.h):
# - Default: link the system libsqlite3. native/shared/NitromelonSqlite.c compiles to almost nothing.
# - Encryption build, when the app opts in: compile the vendored SQLite3 Multiple Ciphers
#   amalgamation (native/vendor/sqlite3mc) through NitromelonSqlite.c, and do not link the system
#   copy. Its symbols are hidden behind prefixed dispatch tables, so it does not clash with the
#   system libsqlite3 or another pod's SQLite.
#
# Opt in with NITROMELONDB_ENCRYPTION=1, or `"nitromelondb": { "encryption": true }` in the app's
# package.json (the first one found above the Podfile). Re-run `pod install` after changing it.
# Encryption is opt-in because the cipher code changes how an app answers App Store
# export-compliance questions, and adds to its size (docs: Encryption/Intro).
# (Lambdas, not `def`: CocoaPods evaluates podspecs inside `module Pod`.)
nitromelon_encryption_flag = lambda do |value, source|
  next value if value == true || value == false

  case value.to_s.strip.downcase
  when '1', 'true' then true
  when '0', 'false' then false
  else raise "NitromelonDB: #{source} must be true or false, got '#{value}'"
  end
end

nitromelon_encryption_enabled = lambda do
  env = ENV['NITROMELONDB_ENCRYPTION']
  return nitromelon_encryption_flag.call(env, 'NITROMELONDB_ENCRYPTION') if env && !env.strip.empty?

  start = begin
    Pod::Config.instance.installation_root
  rescue StandardError
    nil
  end
  return false unless start

  Pathname.new(start).expand_path.ascend do |dir|
    package_json = dir.join('package.json')
    next unless package_json.file?

    app_package = JSON.parse(File.read(package_json))
    # Our own package.json, if the lookup started inside the library (CocoaPods evaluates podspecs
    # from their own directory, e.g. in `pod ipc spec`)
    next if app_package['name'] == package['name']

    options = app_package['nitromelondb']
    return false unless options.is_a?(Hash) && options.key?('encryption')

    value = options['encryption']
    unless value == true || value == false
      raise "NitromelonDB: \"nitromelondb\": { \"encryption\" } in #{package_json} must be true or false, got '#{value}'"
    end
    return value
  end
  false
end

nitromelon_encryption = nitromelon_encryption_enabled.call
Pod::UI.puts('[NitromelonDB] SQLite encryption build (SQLite3 Multiple Ciphers)') if nitromelon_encryption && defined?(Pod::UI)

simdjson_header = File.join(__dir__, 'native', 'vendor', 'simdjson', 'simdjson.h')
unless File.exist?(simdjson_header)
  raise 'NitromelonDB: missing native/vendor/simdjson/simdjson.h (vendored simdjson amalgamation).'
end

Pod::Spec.new do |s|
  s.name         = "NitromelonDB"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.description  = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.author       = { "author" => package["author"] }
  s.platforms    = { :ios => "15.1", :tvos => "15.1" }
  s.source = { :git => "https://github.com/StasDoskalenko/NitromelonDB.git", :tag => "v#{s.version}" }
  s.source_files = "native/ios/**/*.{h,m,mm,swift,c,cpp}", "native/shared/**/*.{h,c,cpp}", "native/nitro/**/*.{h,hpp,c,cpp}", "native/vendor/simdjson/*.{h,cpp}"
  s.public_header_files = [
    # FIXME: I don't think we should be exporting all headers as public
    # (although that is CocoaPods default behavior)
    # but this is needed for NitromelonDB to work in use_frameworks! mode
    # 'native/ios/**/*.h',
    'native/ios/NitromelonDB/JSIInstaller.h',
    'native/ios/NitromelonDB/NitromelonDB.h',
  ]
  s.private_header_files = "native/vendor/simdjson/*.h"
  # Included by native/shared/NitromelonSqlite.c in the encryption build, never compiled or exposed
  # on its own
  s.preserve_paths = "native/vendor/sqlite3mc/**"
  s.pod_target_xcconfig = {
    # FIXME: This is a workaround for broken build in use_frameworks mode
    # I don't think this is a correct fix, but… seems to work?
    # 'OTHER_SWIFT_FLAGS' => '-Xcc -Wno-error=non-modular-include-in-framework-module'
    'HEADER_SEARCH_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/native/nitro" "$(PODS_TARGET_SRCROOT)/native/shared" "$(PODS_TARGET_SRCROOT)/nitrogen/generated/shared/c++" "$(PODS_TARGET_SRCROOT)/native/vendor" "$(PODS_TARGET_SRCROOT)/native/vendor/simdjson"' + (nitromelon_encryption ? ' "$(PODS_TARGET_SRCROOT)/native/vendor/sqlite3mc"' : ''),
  }
  s.requires_arc = true
  # simdjson is annoyingly slow without compiler optimization, disable for debugging
  s.compiler_flags = '-Os ' + (nitromelon_encryption ? '-DNITROMELON_ENCRYPTION=1' : '-DNITROMELON_SYSTEM_SQLITE=1')

  s.libraries = 'sqlite3' unless nitromelon_encryption

  s.dependency "React-Core"
  s.dependency "React-jsi"
  s.dependency "React-callinvoker"

  # New Architecture / JSI (RCTTurboModuleWithJSIBindings). Available when the app
  # Podfile has loaded react_native_pods.rb (standard RN 0.71+ apps).
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React"
  end

  load 'nitrogen/generated/ios/NitromelonDB+autolinking.rb'
  add_nitrogen_files(s)
  s.dependency 'NitroModules'
end
