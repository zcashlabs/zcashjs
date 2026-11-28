require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ZakuraNative"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/zcashlabs/zcashjs"
  s.license      = package["license"]
  s.authors      = "Zcash Labs"
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/zcashlabs/zcashjs.git", :tag => "v#{s.version}" }

  s.source_files = "cpp/**/*.{h,cpp}", "ios/**/*.{h,mm}", "include/*.h"
  s.public_header_files = "ios/ZakuraModuleProvider.h"
  # Built by `cargo xtask build-mobile` in zakura-bindings (device + simulator).
  s.vendored_frameworks = "ios/ZakuraNative.xcframework"
  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "HEADER_SEARCH_PATHS" => "\"$(PODS_TARGET_SRCROOT)/include\" \"$(PODS_TARGET_SRCROOT)/cpp\""
  }

  install_modules_dependencies(s)
end
