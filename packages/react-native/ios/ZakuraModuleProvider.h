#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#ifdef __cplusplus
#import <ReactCommon/RCTTurboModule.h>
#endif

NS_ASSUME_NONNULL_BEGIN

// Supplies the pure C++ NativeZakura TurboModule (codegenConfig.ios.modulesProvider).
@interface ZakuraModuleProvider : NSObject <RCTModuleProvider>
@end

NS_ASSUME_NONNULL_END
