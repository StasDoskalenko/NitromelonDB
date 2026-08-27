### Highlights

### BREAKING CHANGES

- Android Java/JNI package renamed from `com.nozbe.watermelondb` to `com.nitromelondb`. Update any R8/Proguard keep rule (`-keep class com.nitromelondb.** { *; }`) and any direct `NitromelonNative.provideSyncJson` imports. The test harness package `com.nozbe.watermelonTest` is now `com.nitromelondb.test`.
- iOS native sources moved from `native/ios/WatermelonDB/` to `native/ios/NitromelonDB/`. The public umbrella header is now `#import <NitromelonDB/NitromelonDB.h>` (was `#import <NitromelonDB/WatermelonDB.h>`). The C turbo-sync entry point remains `watermelondbProvideSyncJson`.

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal
