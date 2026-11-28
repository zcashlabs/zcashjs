#!/usr/bin/env bash
# Run dist/react-native on the Hermes engine React Native pins, through the real JSI
# module (packages/react-native/cpp) over the native library, after React Native's
# Babel preset, with React Native's abort-controller polyfill and the companion's URL
# setup. Needs: cmake, make, g++, git, ICU (libicu-dev) and `npm run build`.
set -euo pipefail
RN_VERSION="${RN_VERSION:-0.79.2}"
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$root/build/hermes-check"
mkdir -p "$work"
cmake="${CMAKE:-cmake}"

# React Native package (CallInvoker headers, pinned Hermes commit).
"$root/scripts/check-react-native-cpp.sh" >/dev/null
rn="$root/build/rn-cpp-check/rn"
hermes_commit="$(sed -n 's/.*-\([0-9a-f]\{40\}\)$/\1/p' "$rn/sdks/.hermesversion")"
[ -n "$hermes_commit" ]
if [ ! -d "$work/hermes-src" ]; then
  git clone -q https://github.com/facebook/hermes.git "$work/hermes-src"
fi
git -C "$work/hermes-src" checkout -q "$hermes_commit"
if [ ! -f "$work/hermes-build/API/hermes/libhermes.so" ]; then
  icu=()
  [ -n "${ICU_INCLUDE_DIR:-}" ] && icu=(-DICU_INCLUDE_DIR="$ICU_INCLUDE_DIR" -DICU_UC_LIBRARY_RELEASE="$ICU_UC" \
    -DICU_I18N_LIBRARY_RELEASE="$ICU_I18N" -DICU_DATA_LIBRARY_RELEASE="$ICU_DATA")
  "$cmake" -S "$work/hermes-src" -B "$work/hermes-build" -G "Unix Makefiles" -DCMAKE_BUILD_TYPE=Release \
    -DHERMES_ENABLE_INTL=OFF -DHERMES_ENABLE_TEST_SUITE=OFF -DHERMES_ENABLE_DEBUGGER=OFF "${icu[@]}" >/dev/null
  "$cmake" --build "$work/hermes-build" --target libhermes -j"$(nproc)" >/dev/null
fi

# What React Native installs around Hermes, and Metro's Babel preset.
if [ ! -d "$work/polyfills/node_modules/react-native-url-polyfill" ]; then
  mkdir -p "$work/polyfills" && (cd "$work/polyfills" && printf '{"private":true}\n' > package.json \
    && npm install --ignore-scripts --no-audit --no-fund abort-controller@3.0.0 react-native-url-polyfill@2.0.0 >/dev/null)
fi
if [ ! -d "$work/babel/node_modules/@react-native/babel-preset" ]; then
  mkdir -p "$work/babel" && (cd "$work/babel" && printf '{"private":true}\n' > package.json \
    && npm install --ignore-scripts --no-audit --no-fund @babel/core@7 "@react-native/babel-preset@$RN_VERSION" >/dev/null)
fi

# The native library at the pinned revision (host build).
revision="$(node -p "require('$root/scripts/native-source.json').revision")"
native="$root/.cache/native/$revision/mobile-host"
if [ ! -f "$native/native-build.json" ]; then
  (cd "$root/.cache/native/$revision/source" && cargo xtask build-mobile --targets host --output "$native" \
    --cache "$root/.cache/native/cache")
fi

HERMES_SRC="$work/hermes-src" HERMES_BUILD="$work/hermes-build" RN_ROOT="$rn" POLYFILLS="$work/polyfills/node_modules" \
  NATIVE="$native" BABEL="$work/babel/node_modules" node "$root/tests/react-native/hermes/run.mjs"
