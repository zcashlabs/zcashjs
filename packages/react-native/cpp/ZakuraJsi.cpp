#include "ZakuraJsi.h"
#include "zakura_native.h"

#include <cmath>
#include <string>
#include <thread>
#include <vector>

using namespace facebook;

namespace zakura {
namespace {

// Copy a Uint8Array argument (handles views at any offset).
std::vector<uint8_t> bytesOf(jsi::Runtime &rt, const jsi::Value &value) {
  if (!value.isObject()) throw jsi::JSError(rt, "INVALID_ARGUMENT");
  jsi::Object view = value.asObject(rt);
  jsi::Value backing = view.getProperty(rt, "buffer");
  if (!backing.isObject() || !backing.asObject(rt).isArrayBuffer(rt)) throw jsi::JSError(rt, "INVALID_ARGUMENT");
  jsi::ArrayBuffer buffer = backing.asObject(rt).getArrayBuffer(rt);
  const double offset = view.getProperty(rt, "byteOffset").asNumber();
  const double length = view.getProperty(rt, "byteLength").asNumber();
  if (offset < 0 || length < 0 || offset + length > static_cast<double>(buffer.size(rt))) {
    throw jsi::JSError(rt, "INVALID_ARGUMENT");
  }
  const uint8_t *data = buffer.data(rt) + static_cast<size_t>(offset);
  return std::vector<uint8_t>(data, data + static_cast<size_t>(length));
}

uint64_t idOf(jsi::Runtime &rt, const jsi::Value &value) {
  if (!value.isNumber()) throw jsi::JSError(rt, "INVALID_ARGUMENT");
  const double number = value.asNumber();
  if (!(number >= 0 && number <= 9007199254740991.0) || std::floor(number) != number) {
    throw jsi::JSError(rt, "INVALID_ARGUMENT");
  }
  return static_cast<uint64_t>(number);
}

// A native result buffer adopted by a JS ArrayBuffer without copying.
class ResultBuffer : public jsi::MutableBuffer {
 public:
  explicit ResultBuffer(ZbBuffer buffer) : buffer_(buffer) {}
  ~ResultBuffer() override { zb_buffer_free(buffer_); }
  size_t size() const override { return buffer_.len; }
  uint8_t *data() override { return buffer_.ptr; }

 private:
  ZbBuffer buffer_;
};

jsi::Value toUint8Array(jsi::Runtime &rt, ZbBuffer result) {
  jsi::ArrayBuffer buffer(rt, std::make_shared<ResultBuffer>(result));
  return rt.global().getPropertyAsFunction(rt, "Uint8Array").callAsConstructor(rt, buffer);
}

jsi::Function method(jsi::Runtime &rt, const char *name, unsigned arity, jsi::HostFunctionType body) {
  return jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, name), arity, std::move(body));
}

}  // namespace

void install(jsi::Runtime &rt, std::shared_ptr<react::CallInvoker> invoker) {
  if (zb_abi_version() != 1) throw jsi::JSError(rt, "PROTOCOL_MISMATCH");
  jsi::Object native(rt);

  native.setProperty(rt, "call", method(rt, "call", 3,
      [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        if (count != 3 || !args[1].isString()) throw jsi::JSError(rt, "INVALID_ARGUMENT");
        const uint64_t runtime = idOf(rt, args[0]);
        const std::string name = args[1].asString(rt).utf8(rt);
        const std::vector<uint8_t> bytes = bytesOf(rt, args[2]);
        return toUint8Array(rt, zb_call(runtime, reinterpret_cast<const uint8_t *>(name.data()), name.size(),
                                        bytes.data(), bytes.size()));
      }));

  // Owner-thread calls: the Rust runtime does the work; a waiter thread hands the
  // result back to the JS thread through the CallInvoker.
  native.setProperty(rt, "start", method(rt, "start", 3,
      [invoker](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        if (count != 3 || !args[1].isString()) throw jsi::JSError(rt, "INVALID_ARGUMENT");
        const uint64_t runtime = idOf(rt, args[0]);
        const std::string name = args[1].asString(rt).utf8(rt);
        const std::vector<uint8_t> bytes = bytesOf(rt, args[2]);
        const uint64_t ticket = zb_call_start(runtime, reinterpret_cast<const uint8_t *>(name.data()), name.size(),
                                              bytes.data(), bytes.size());
        jsi::Function promise = rt.global().getPropertyAsFunction(rt, "Promise");
        return promise.callAsConstructor(rt, method(rt, "executor", 2,
            [invoker, ticket](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *executor, size_t) -> jsi::Value {
              auto resolve = std::make_shared<jsi::Function>(executor[0].asObject(rt).asFunction(rt));
              std::thread([invoker, ticket, resolve = std::move(resolve)]() mutable {
                ZbBuffer result = zb_call_wait(ticket);
                // Only the JS thread touches (and releases) the resolve function.
                invoker->invokeAsync([resolve = std::move(resolve), result](jsi::Runtime &rt) {
                  resolve->call(rt, toUint8Array(rt, result));
                });
              }).detach();
              return jsi::Value::undefined();
            }));
      }));

  native.setProperty(rt, "createRuntime", method(rt, "createRuntime", 0,
      [](jsi::Runtime &, const jsi::Value &, const jsi::Value *, size_t) -> jsi::Value {
        return jsi::Value(static_cast<double>(zb_runtime_create()));
      }));

  native.setProperty(rt, "destroyRuntime", method(rt, "destroyRuntime", 1,
      [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        if (count != 1) throw jsi::JSError(rt, "INVALID_ARGUMENT");
        zb_runtime_destroy(idOf(rt, args[0]));
        return jsi::Value::undefined();
      }));

  rt.global().setProperty(rt, "__zakuraNative", std::move(native));
}

}  // namespace zakura
