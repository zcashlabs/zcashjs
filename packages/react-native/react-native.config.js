// Autolinking for the pure C++ TurboModule on Android (iOS uses the podspec and
// codegenConfig.ios.modulesProvider).
module.exports = {
  dependency: {
    platforms: {
      android: {
        cxxModuleCMakeListsModuleName: 'react_codegen_zakura_native',
        cxxModuleCMakeListsPath: 'CMakeLists.txt',
        cxxModuleHeaderName: 'NativeZakura',
      },
    },
  },
};
