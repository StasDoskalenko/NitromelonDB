#pragma once

#include <jni.h>

namespace watermelondb {
namespace platform {

void configureJNI(JNIEnv *env);
void provideJson(int id, jbyteArray array);
void destroy();
void triggerMemoryAlert();

} // namespace platform
} // namespace watermelondb
