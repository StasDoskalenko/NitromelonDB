#ifdef __OBJC__
#import <UIKit/UIKit.h>
#else
#ifndef FOUNDATION_EXPORT
#if defined(__cplusplus)
#define FOUNDATION_EXPORT extern "C"
#else
#define FOUNDATION_EXPORT extern
#endif
#endif
#endif

#import "AnyMap.hpp"
#import "ArrayBuffer.hpp"
#import "HybridObject.hpp"
#import "Null.hpp"
#import "Promise.hpp"
#import "HybridNitroModulesProxy.hpp"
#import "InstallNitro.hpp"
#import "HybridObjectRegistry.hpp"
#import "JSIConverter.hpp"
#import "JSIHelpers.hpp"
#import "NitroLogger.hpp"
#import "Dispatcher.hpp"
#import "JSCallback.hpp"
#import "FastVectorCopy.hpp"
#import "NitroHash.hpp"
#import "NitroDefines.hpp"
#import "PropNameIDCache.hpp"
#import "CachedProp.hpp"
#import "ArrayBufferHolder.hpp"
#import "PromiseHolder.hpp"
#import "AnyMapUtils.hpp"
#import "Result.hpp"
#import "DateToChronoDate.hpp"
#import "RuntimeError.hpp"
#import "SwiftClosure.hpp"

FOUNDATION_EXPORT double NitroModulesVersionNumber;
FOUNDATION_EXPORT const unsigned char NitroModulesVersionString[];

