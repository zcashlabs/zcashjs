#include "NativeZakura.h"
#include "ZakuraJsi.h"

namespace facebook::react {

NativeZakura::NativeZakura(std::shared_ptr<CallInvoker> jsInvoker)
    : NativeZakuraCxxSpec(std::move(jsInvoker)) {}

bool NativeZakura::install(jsi::Runtime &runtime) {
  zakura::install(runtime, jsInvoker_);
  return true;
}

}  // namespace facebook::react
