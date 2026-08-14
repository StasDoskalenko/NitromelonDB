#include <jni.h>
#include <fbjni/fbjni.h>
#include "NitromelonDBOnLoad.hpp"
#include "DatabasePlatformAndroid.h"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::watermelondb::registerAllNatives();
    watermelondb::platform::configureJNI(facebook::jni::Environment::current());
  });
}

extern "C"
JNIEXPORT void JNICALL
Java_com_nozbe_watermelondb_NitromelonNative_onCatalystInstanceDestroy(JNIEnv*, jclass) {
  watermelondb::platform::destroy();
}

extern "C"
JNIEXPORT void JNICALL
Java_com_nozbe_watermelondb_NitromelonNative_provideSyncJson(JNIEnv* env, jclass, jint id, jbyteArray array) {
  watermelondb::platform::provideJson(id, array);
}
