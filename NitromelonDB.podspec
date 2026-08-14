require "json"
require "fileutils"

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# Compile npm `@nozbe/simdjson` into this pod (same target as Nitrogen's DEFINES_MODULE).
# `s.dependency "simdjson"` would resolve CocoaPods trunk, which is the wrong library.
# CocoaPods also cannot set `:path` / `modular_headers` on a podspec dependency, so a
# separate `pod 'simdjson'` line in the app Podfile is not required.
def nitromelondb_vendor_simdjson!(pod_root)
  vendor = File.join(pod_root, 'native', 'vendor', 'simdjson')
  header = File.join(vendor, 'simdjson.h')
  return vendor if File.exist?(header)

  pkg = if defined?(Pod::Executable)
    Pod::Executable.execute_command('node', [
      '-p',
      'require.resolve("@nozbe/simdjson/package.json", {paths:[process.argv[1]]})',
      pod_root,
    ]).strip
  else
    `node --print "require.resolve('@nozbe/simdjson/package.json', {paths:['#{pod_root}']})"`.strip
  end
  raise 'NitromelonDB: could not resolve @nozbe/simdjson. Run yarn/npm install first.' if pkg.nil? || pkg.empty?

  src = File.join(File.dirname(pkg), 'src')
  FileUtils.mkdir_p(vendor)
  FileUtils.cp(File.join(src, 'simdjson.h'), header)
  FileUtils.cp(File.join(src, 'simdjson.cpp'), File.join(vendor, 'simdjson.cpp'))
  vendor
end

nitromelondb_vendor_simdjson!(__dir__)

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
    # but this is needed for WatermelonDB to work in use_frameworks! mode
    # 'native/ios/**/*.h',
    'native/ios/WatermelonDB/JSIInstaller.h',
    'native/ios/WatermelonDB/WatermelonDB.h',
  ]
  s.private_header_files = "native/vendor/simdjson/*.h"
  s.pod_target_xcconfig = {
    # FIXME: This is a workaround for broken build in use_frameworks mode
    # I don't think this is a correct fix, but… seems to work?
    # 'OTHER_SWIFT_FLAGS' => '-Xcc -Wno-error=non-modular-include-in-framework-module'
    'HEADER_SEARCH_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/native/nitro" "$(PODS_TARGET_SRCROOT)/native/shared" "$(PODS_TARGET_SRCROOT)/nitrogen/generated/shared/c++" "$(PODS_TARGET_SRCROOT)/native/vendor" "$(PODS_TARGET_SRCROOT)/native/vendor/simdjson"',
  }
  s.requires_arc = true
  # simdjson is annoyingly slow without compiler optimization, disable for debugging
  s.compiler_flags = '-Os'

  s.libraries = 'sqlite3'

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
