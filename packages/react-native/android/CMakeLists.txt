# Pure C++ TurboModule for React Native autolinking (react-native.config.js).
cmake_minimum_required(VERSION 3.13)
project(ZakuraNative)
set(CMAKE_CXX_STANDARD 20)

set(ZAKURA_ROOT ${CMAKE_CURRENT_LIST_DIR}/..)

add_library(zakura_bindings_native SHARED IMPORTED)
set_target_properties(zakura_bindings_native PROPERTIES
  IMPORTED_LOCATION ${CMAKE_CURRENT_LIST_DIR}/src/main/jniLibs/${ANDROID_ABI}/libzakura_bindings_native.so)

add_library(react_codegen_zakura_native OBJECT
  ${ZAKURA_ROOT}/cpp/NativeZakura.cpp
  ${ZAKURA_ROOT}/cpp/ZakuraJsi.cpp)
target_include_directories(react_codegen_zakura_native PUBLIC ${ZAKURA_ROOT}/cpp ${ZAKURA_ROOT}/include)
# React Native >= 0.76 merges its native libraries into libreactnative.so.
target_link_libraries(react_codegen_zakura_native jsi reactnative react_codegen_ZakuraNativeSpec
  zakura_bindings_native)
