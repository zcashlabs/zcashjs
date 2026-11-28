// Runs a JS bundle on the Hermes engine React Native 0.79 ships, with the real
// @zcashlabs/zcash.js-native JSI module (packages/react-native/cpp/ZakuraJsi.cpp)
// installed over the native Zakura library: the device code path minus the mobile OS.
//
// The host supplies what React Native itself provides around Hermes: timers,
// performance.now, console, microtask draining and a CallInvoker (the JS-thread
// task queue). Usage: zakura-hermes-host BUNDLE.js SCRATCH_DIRECTORY
#include <hermes/hermes.h>
#include <ReactCommon/CallInvoker.h>
#include "ZakuraJsi.h"

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <deque>
#include <fstream>
#include <functional>
#include <iostream>
#include <map>
#include <mutex>
#include <sstream>

using namespace facebook;

namespace {

using Clock = std::chrono::steady_clock;

// The JS thread's task queue: CallInvoker work from native threads plus timers.
class Loop : public react::CallInvoker {
 public:
  void invokeAsync(react::CallFunc &&func) noexcept override {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      tasks_.push_back(std::move(func));
    }
    ready_.notify_one();
  }
  void invokeSync(react::CallFunc &&) override { std::abort(); }

  uint64_t addTimer(double ms, std::shared_ptr<jsi::Function> fn) {
    auto when = Clock::now() + std::chrono::microseconds(static_cast<int64_t>(std::max(0.0, ms) * 1000));
    uint64_t id = ++nextTimer_;
    timers_.emplace(std::make_pair(when, id), std::move(fn));
    return id;
  }
  void clearTimer(uint64_t id) {
    for (auto it = timers_.begin(); it != timers_.end(); ++it) {
      if (it->first.second == id) { timers_.erase(it); return; }
    }
  }
  // Runs until `done`, or until idle for two minutes with nothing scheduled.
  void run(jsi::Runtime &rt, const std::function<bool()> &done) {
    rt.drainMicrotasks();
    while (!done()) {
      react::CallFunc task;
      {
        std::unique_lock<std::mutex> lock(mutex_);
        if (tasks_.empty()) {
          // Idle: owner-thread results arrive through invokeAsync.
          auto deadline = timers_.empty() ? Clock::now() + std::chrono::seconds(120) : timers_.begin()->first.first;
          bool woke = ready_.wait_until(lock, deadline, [&] { return !tasks_.empty(); });
          if (!woke && timers_.empty()) return;
        }
        if (!tasks_.empty()) {
          task = std::move(tasks_.front());
          tasks_.pop_front();
        }
      }
      if (task) {
        task(rt);
      } else if (!timers_.empty() && timers_.begin()->first.first <= Clock::now()) {
        auto fn = timers_.begin()->second;
        timers_.erase(timers_.begin());
        fn->call(rt);
      }
      rt.drainMicrotasks();
    }
  }

 private:
  std::mutex mutex_;
  std::condition_variable ready_;
  std::deque<react::CallFunc> tasks_;
  std::map<std::pair<Clock::time_point, uint64_t>, std::shared_ptr<jsi::Function>> timers_;
  uint64_t nextTimer_ = 0;
};

jsi::Function method(jsi::Runtime &rt, const char *name, unsigned arity, jsi::HostFunctionType body) {
  return jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, name), arity, std::move(body));
}

}  // namespace

int main(int argc, char **argv) {
  if (argc != 3) {
    std::cerr << "usage: zakura-hermes-host BUNDLE.js SCRATCH_DIRECTORY\n";
    return 2;
  }
  std::ifstream file(argv[1]);
  std::stringstream source;
  source << file.rdbuf();

  auto runtime = facebook::hermes::makeHermesRuntime(
      // Hermes as React Native configures it: the bundle has been through Metro's Babel
      // preset (see run.mjs), which lowers classes and other unsupported syntax.
      ::hermes::vm::RuntimeConfig::Builder().withMicrotaskQueue(true).withES6Proxy(true).build());
  jsi::Runtime &rt = *runtime;
  auto loop = std::make_shared<Loop>();
  auto global = rt.global();
  const auto start = Clock::now();

  global.setProperty(rt, "setTimeout", method(rt, "setTimeout", 2,
      [loop](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        auto fn = std::make_shared<jsi::Function>(args[0].asObject(rt).asFunction(rt));
        double ms = count > 1 && args[1].isNumber() ? args[1].asNumber() : 0;
        return jsi::Value(static_cast<double>(loop->addTimer(ms, fn)));
      }));
  global.setProperty(rt, "clearTimeout", method(rt, "clearTimeout", 1,
      [loop](jsi::Runtime &, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        if (count && args[0].isNumber()) loop->clearTimer(static_cast<uint64_t>(args[0].asNumber()));
        return jsi::Value::undefined();
      }));
  global.setProperty(rt, "setImmediate", method(rt, "setImmediate", 1,
      [loop](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t) -> jsi::Value {
        auto fn = std::make_shared<jsi::Function>(args[0].asObject(rt).asFunction(rt));
        return jsi::Value(static_cast<double>(loop->addTimer(0, fn)));
      }));
  jsi::Object performance(rt);
  performance.setProperty(rt, "now", method(rt, "now", 0,
      [start](jsi::Runtime &, const jsi::Value &, const jsi::Value *, size_t) -> jsi::Value {
        return jsi::Value(std::chrono::duration<double, std::milli>(Clock::now() - start).count());
      }));
  global.setProperty(rt, "performance", performance);
  global.setProperty(rt, "__hostPrint", method(rt, "__hostPrint", 1,
      [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        if (count) std::cout << args[0].toString(rt).utf8(rt) << std::endl;
        return jsi::Value::undefined();
      }));

  global.setProperty(rt, "__hostScratch", jsi::String::createFromUtf8(rt, argv[2]));
  // What @zcashlabs/zcash.js-native's TurboModule install() does on a device.
  zakura::install(rt, loop);

  int status = 0;
  try {
    rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(source.str()), argv[1]);
    loop->run(rt, [&] { return rt.global().getProperty(rt, "__hostDone").isBool(); });
    jsi::Value done = rt.global().getProperty(rt, "__hostDone");
    if (!done.isBool() || !done.getBool()) {
      jsi::Value error = rt.global().getProperty(rt, "__hostError");
      std::cerr << "FAILED: " << (error.isUndefined() ? "event loop drained before completion" : error.toString(rt).utf8(rt))
                << std::endl;
      status = 1;
    }
  } catch (const jsi::JSError &error) {
    std::cerr << "JSError: " << error.getMessage() << "\n" << error.getStack() << std::endl;
    status = 1;
  } catch (const std::exception &error) {
    std::cerr << "error: " << error.what() << std::endl;
    status = 1;
  }
  return status;
}
