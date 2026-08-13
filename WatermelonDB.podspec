require "json"

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = "WatermelonDB"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.description  = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.author       = { "author" => package["author"] }
  s.platforms    = { :ios => "15.1", :tvos => "15.1" }
  s.source = { :git => "https://github.com/Nozbe/WatermelonDB.git", :tag => "v#{s.version}" }
  s.source_files = "native/ios/**/*.{h,m,mm,swift,c,cpp}", "native/shared/**/*.{h,c,cpp}"
  s.public_header_files = [
    # FIXME: I don't think we should be exporting all headers as public
    # (although that is CocoaPods default behavior)
    # but this is needed for WatermelonDB to work in use_frameworks! mode
    # 'native/ios/**/*.h',
    'native/ios/WatermelonDB/JSIInstaller.h',
    'native/ios/WatermelonDB/WatermelonDB.h',
  ]
  s.pod_target_xcconfig = {
    # FIXME: This is a workaround for broken build in use_frameworks mode
    # I don't think this is a correct fix, but… seems to work?
    # 'OTHER_SWIFT_FLAGS' => '-Xcc -Wno-error=non-modular-include-in-framework-module'
  }
  s.requires_arc = true
  # simdjson is annoyingly slow without compiler optimization, disable for debugging
  s.compiler_flags = '-Os'

  s.libraries = 'sqlite3'

  s.dependency "React-Core"
  s.dependency "React-jsi"

  # New Architecture / JSI (RCTTurboModuleWithJSIBindings). Available when the app
  # Podfile has loaded react_native_pods.rb (standard RN 0.71+ apps).
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React"
  end

  # NOTE: NPM-vendored @nozbe/simdjson must be used, not the CocoaPods version
  s.dependency "simdjson"
end
