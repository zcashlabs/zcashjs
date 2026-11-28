package com.zcashlabs.zakuranative;

import com.facebook.react.BaseReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfoProvider;
import java.util.HashMap;

/**
 * Autolinking entry point. NativeZakura is a pure C++ TurboModule registered through
 * the C++ autolinking in react-native.config.js, so this package provides no Java modules.
 */
public class ZakuraNativePackage extends BaseReactPackage {
  @Override
  public NativeModule getModule(String name, ReactApplicationContext context) {
    return null;
  }

  @Override
  public ReactModuleInfoProvider getReactModuleInfoProvider() {
    return HashMap::new;
  }
}
