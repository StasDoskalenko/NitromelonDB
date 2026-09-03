#pragma once

#include <functional>
#include <string>
#include "Database.h"

namespace watermelondb {
namespace platform {

// Logs to console
void consoleLog(std::string message);

// Logs error to console
void consoleError(std::string message);

// Called before a Sqlite object is constructed
// Use to initialize sqlite, if necessary
void initializeSqlite();

// Given a database name, returns a fully-qualified default database path
// e.g. /Users/foo.app/<name>.db
std::string resolveDatabasePath(std::string path);

// Android-only: whether platform::initializeSqlite() successfully resolved and applied
// a real, app-sandboxed sqlite3_temp_directory via JNI (see DatabasePlatformAndroid.cpp).
// Database.cpp's Android-only pragma temp_store=memory fallback is gated on this
// returning false, so a JNI resolution failure can't silently reintroduce the original
// "no temp store" IO error. Other platforms don't call this (their Database.cpp call
// site is #ifdef ANDROID), so they don't need to implement it.
bool hasNativeTempDirectory();

// Removes database file located at `path`.
// Throws an exception if it's not possible to delete this file
void deleteDatabaseFile(std::string path, bool warnIfDoesNotExist);

// Calls function when device memory is getting low
void onMemoryAlert(std::function<void(void)> callback);

// Stores sync json provided by JS (Nitro / NativeModule)
void provideSyncJson(int id, std::string json);

// Returns sync json provided by the user
std::string_view getSyncJson(int id);

// Destroys sync json after it's used
void deleteSyncJson(int id);

// Called when React Native bridge is being torn down
void onDestroy(std::function<void(void)> callback);

} // namespace platform
} // namespace watermelondb
