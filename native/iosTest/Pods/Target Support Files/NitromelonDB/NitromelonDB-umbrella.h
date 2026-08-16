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

#import "JSIInstaller.h"
#import "WatermelonDB.h"
#import "HybridNitromelonDatabaseSpec.hpp"
#import "HybridNitromelonSpec.hpp"
#import "NitromelonInitializeResult.hpp"
#import "NitromelonDB-Swift-Cxx-Bridge.hpp"

FOUNDATION_EXPORT double NitromelonDBVersionNumber;
FOUNDATION_EXPORT const unsigned char NitromelonDBVersionString[];

