// Installs globalThis.__zakuraNative: the transport @zcashlabs/zcash.js uses on
// React Native to reach the Zakura core (zakura-bindings-native C ABI).
#pragma once
#include <jsi/jsi.h>
#include <ReactCommon/CallInvoker.h>
#include <memory>

namespace zakura {
void install(facebook::jsi::Runtime &runtime, std::shared_ptr<facebook::react::CallInvoker> invoker);
}
