#include <jni.h>
#include <jsi/jsi.h>

#include "DatabasePlatformAndroid.h"

using namespace facebook;

extern "C" JNIEXPORT void JNICALL Java_com_nozbe_watermelondb_jsi_JSIInstaller_installBinding(JNIEnv *env, jobject thiz, jlong runtimePtr) {
    (void)thiz;
    (void)runtimePtr;
    watermelondb::platform::configureJNI(env);
}

extern "C" JNIEXPORT void JNICALL Java_com_nozbe_watermelondb_jsi_JSIInstaller_provideSyncJson(JNIEnv *env, jclass clazz, jint id, jbyteArray array) {
    watermelondb::platform::provideJson(id, array);
}

extern "C" JNIEXPORT void JNICALL Java_com_nozbe_watermelondb_jsi_JSIInstaller_destroy(JNIEnv *env, jclass clazz) {
    watermelondb::platform::destroy();
}
