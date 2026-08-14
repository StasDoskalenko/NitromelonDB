# Keep JNI / Nitro loaders. Release minify (including EAS production) would
# otherwise strip WatermelonDBPackage's static block and NitromelonDBOnLoad.
-keep class com.nozbe.watermelondb.** { *; }
-keep class com.margelo.nitro.watermelondb.** { *; }
