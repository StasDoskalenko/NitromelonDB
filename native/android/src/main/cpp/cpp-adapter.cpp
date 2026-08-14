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
