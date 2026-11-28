#!/usr/bin/env bash
# Compile the @zcashlabs/zcash.js-native C++ sources against React Native's real
# headers: the JSI/TurboModule/bridging headers from the react-native package, the
# codegen output for src/NativeZakura.ts, and the Folly/fmt/Boost/double-conversion
# versions React Native pins. A syntax/type check; device builds link the real libraries.
set -euo pipefail
RN_VERSION="${RN_VERSION:-0.79.2}"
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$root/build/rn-cpp-check"
mkdir -p "$work" && cd "$work"
if [ ! -d rn ]; then
  npm pack "react-native@$RN_VERSION" --silent >/dev/null && mkdir rn && tar -xzf "react-native-$RN_VERSION.tgz" -C rn --strip-components=1
fi
versions="rn/gradle/libs.versions.toml"
version() { sed -n "s/^$1=\"\(.*\)\"/\1/p" "$versions"; }
[ -d folly ] || git clone -q --depth 1 --branch "v$(version folly)" https://github.com/facebook/folly.git folly
[ -d fmt ] || git clone -q --depth 1 --branch "$(sed -n 's/.*:tag => "\(.*\)".*/\1/p' rn/third-party-podspecs/fmt.podspec)" https://github.com/fmtlib/fmt.git fmt
[ -d boost-preprocessor ] || git clone -q --depth 1 --branch boost-1.84.0 https://github.com/boostorg/preprocessor.git boost-preprocessor
if [ ! -d double-conversion ]; then
  git clone -q --depth 1 --branch "v$(version doubleconversion)" https://github.com/google/double-conversion.git dc-src
  mkdir -p double-conversion/double-conversion && cp dc-src/src/*.h double-conversion/double-conversion/
fi
if [ ! -f codegen/ZakuraNativeSpecJSI.h ]; then
  npm pack "@react-native/codegen@$RN_VERSION" invariant@2.2.4 loose-envify@1.4.0 --silent >/dev/null
  mkdir -p cg node_modules/invariant node_modules/loose-envify codegen
  tar -xzf "react-native-codegen-$RN_VERSION.tgz" -C cg --strip-components=1
  tar -xzf invariant-2.2.4.tgz -C node_modules/invariant --strip-components=1
  tar -xzf loose-envify-1.4.0.tgz -C node_modules/loose-envify --strip-components=1
  # Schema of packages/react-native/src/NativeZakura.ts: install(): boolean.
  node -e "
    const gen = require('./cg/lib/generators/modules/GenerateModuleH.js');
    const schema = { modules: { NativeZakura: { type: 'NativeModule', aliasMap: {}, enumMap: {}, moduleName: 'NativeZakura',
      spec: { eventEmitters: [], methods: [{ name: 'install', optional: false, typeAnnotation: {
        type: 'FunctionTypeAnnotation', returnTypeAnnotation: { type: 'BooleanTypeAnnotation' }, params: [] } }] } } } };
    for (const [name, code] of gen.generate('ZakuraNativeSpec', schema, undefined, false, '')) require('fs').writeFileSync('codegen/' + name, code);"
fi
R=rn/ReactCommon
flags=(-std=c++20 -fsyntax-only -Wall -Wextra -Werror=return-type
  -DFOLLY_NO_CONFIG=1 -DFOLLY_MOBILE=1 -DFOLLY_CFG_NO_COROUTINES=1 -DFOLLY_HAVE_CLOCK_GETTIME=1 -DFOLLY_HAVE_PTHREAD=1
  -isystem boost-preprocessor/include -isystem double-conversion -isystem folly -isystem fmt/include
  -isystem "$R" -isystem "$R/jsi" -isystem "$R/callinvoker" -isystem "$R/react/nativemodule/core" -isystem "$R/react/bridging"
  -isystem "$R/react/timing" -isystem "$R/runtimeexecutor" -isystem "$R/react/debug" -isystem "$R/cxxreact" -isystem "$R/react/utils"
  -isystem codegen -I "$root/packages/react-native/include" -I "$root/packages/react-native/cpp")
for source in "$root"/packages/react-native/cpp/*.cpp; do
  "${CXX:-g++}" "${flags[@]}" "$source"
  echo "ok: ${source#"$root"/}"
done
