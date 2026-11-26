#pragma once

// The only way native code may include SQLite. Never `#include <sqlite3.h>` directly: in the
// encryption build there is no sqlite3.h on the include path, and with symbol isolation
// (NitromelonSqliteConfig.h) calls through another SQLite's header would not reach our copy.

#include "NitromelonSqliteConfig.h"

#if NITROMELON_ENCRYPTION
#include "sqlite3mc_amalgamation.h"
#else
// native/vendor/sqlite on Android and Windows, the SDK's header on iOS (system libsqlite3)
#include <sqlite3.h>
#endif

#ifdef __cplusplus
extern "C" {
#endif

// Sets sqlite3_temp_directory. In the encryption build that global is not reachable through the
// dispatch tables, so it is set from NitromelonSqlite.c, next to the amalgamation. Same contract
// as the variable: call it before opening any connection, and keep `path` alive for the life of
// the process (SQLite does not copy it).
void nitromelon_sqlite3_set_temp_directory(char *path);

#if NITROMELON_ENCRYPTION
// How many pages the temporary database of a running VACUUM has so far (0: none running). For
// encryption progress (encryption::RekeyProgress): sqlite3mc encrypts a plain database by vacuuming it
// into one with room for SQLCipher's per-page HMAC. Uses SQLite's internals, so it lives next to the
// amalgamation. Call it on the connection's own thread, e.g. from its progress handler.
int nitromelon_sqlite3_vacuum_page_count(sqlite3 *db);
#endif

#ifdef __cplusplus
}
#endif
