### Highlights

### BREAKING CHANGES

- Android Java/JNI package renamed from `com.nozbe.watermelondb` to `com.nitromelondb`. Update any R8/Proguard keep rule (`-keep class com.nitromelondb.** { *; }`) and any direct `NitromelonNative.provideSyncJson` imports. The test harness package `com.nozbe.watermelonTest` is now `com.nitromelondb.test`.

### Deprecations

### New features

### Fixes

### Performance

### Changes

### Internal
