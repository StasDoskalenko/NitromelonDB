#pragma once

#import <Foundation/Foundation.h>

#ifdef __cplusplus
extern "C"
{
#endif

void watermelondbProvideSyncJson(int id, NSData *json, NSError **errorPtr);

#ifdef __cplusplus
} // extern "C"
#endif
