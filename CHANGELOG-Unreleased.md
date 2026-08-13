### Highlights

### BREAKING CHANGES

- Minimum supported Node.js version is now 22.x (required by React Native 0.87)
- [iOS] Minimum deployment target is now iOS 15.1
- [Android] Minimum SDK version is now 24

### Deprecations

### New features

### Fixes

- [LokiJS] Multitab sync issue fix
- [Android] Added linker flag for building with 16kB page alignment
- [TS] make catchError visible to typescript

### Performance

### Changes

- Updated better-sqlite3 to 13.0.3
- Support for React Native 0.87 and React 19

### Internal

- Updated internal dependencies
- Updated documentation scripts
- [CI] Run JavaScript tests on Node.js 24 only
- [CI] Run iOS tests on macOS 26 / latest stable Xcode / iPhone 17 (iOS 26)
- [CI] Android tests use JDK 21
- [CI] Use latest CocoaPods (1.17) without the old 1.15 / xcodeproj / ethon pins
