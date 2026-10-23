# Consumer R8/ProGuard rules, merged into the app's release build (consumerProguardFiles).

# DatabasePlatformAndroid.cpp looks this class and its static methods up by name over JNI
# (FindClass + GetStaticMethodID), which R8 can't see. Without this, apps with
# minifyEnabled (the default since Expo SDK 58) abort on the first database open with
# ClassNotFoundException: com.nitromelondb.NativeDatabasePath.
-keep class com.nitromelondb.NativeDatabasePath {
    static java.lang.String _resolveDatabasePath(java.lang.String);
    static java.lang.String _getTempDirectory();
}

# cpp-adapter.cpp binds these through Java_com_nitromelondb_NitromelonNative_* symbol names.
-keepclasseswithmembernames class com.nitromelondb.NitromelonNative {
    native <methods>;
}
