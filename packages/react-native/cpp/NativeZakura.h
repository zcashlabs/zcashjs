// Pure C++ TurboModule: install() adds the JSI transport to the calling runtime.
#pragma once
#include <ZakuraNativeSpecJSI.h>
#include <memory>

namespace facebook::react {

class NativeZakura : public NativeZakuraCxxSpec<NativeZakura> {
 public:
  static constexpr auto kModuleName = "NativeZakura";
  explicit NativeZakura(std::shared_ptr<CallInvoker> jsInvoker);
  bool install(jsi::Runtime &runtime);
};

}  // namespace facebook::react
